import Combine
import CoreBluetooth
import Foundation
import UIKit

struct PrinterDevice: Identifiable {
    let id: String
    let name: String
    let rssi: Int
    let peripheral: CBPeripheral
}

final class PrinterManager: NSObject, ObservableObject {
    @Published private(set) var devices: [PrinterDevice] = []
    @Published private(set) var isScanning = false
    @Published private(set) var isPrinting = false
    @Published private(set) var bluetoothState = "初始化"
    @Published private(set) var connectedPrinterName: String?
    @Published private(set) var connectedPrinterId: String?
    @Published private(set) var savedPrinterName: String?
    @Published private(set) var savedPrinterId: String?
    @Published var statusMessage: String?

    private let savedPrinterIdKey = "savedPrinterId"
    private let savedPrinterNameKey = "savedPrinterName"
    private let printerServiceUUID = CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455")
    private let printerCharacteristicUUID = CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3")
    private var centralManager: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private var printCharacteristic: CBCharacteristic?

    private var currentPrintContinuation: CheckedContinuation<Void, Error>?
    private var currentPrintChunks: [Data] = []
    private var currentPrintChunkIndex = 0
    private var currentWriteType: CBCharacteristicWriteType?
    private var isAwaitingWriteResponse = false
    private var currentPrintLabel: String?
    private var backgroundObserver: NSObjectProtocol?

    var isPrinterReady: Bool {
        connectedPeripheral != nil && printCharacteristic != nil
    }

    override init() {
        super.init()
        savedPrinterId = UserDefaults.standard.string(forKey: savedPrinterIdKey)
        savedPrinterName = UserDefaults.standard.string(forKey: savedPrinterNameKey)
        centralManager = CBCentralManager(delegate: self, queue: nil)
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cancelCurrentPrint(reason: .appMovedToBackground)
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
    }

    func startScan() {
        guard centralManager.state == .poweredOn else {
            statusMessage = "藍牙尚未可用"
            return
        }

        devices.removeAll()
        isScanning = true
        statusMessage = "掃描中"
        centralManager.scanForPeripherals(withServices: nil, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])
    }

    func stopScan() {
        centralManager.stopScan()
        isScanning = false
        statusMessage = "已停止掃描"
    }

    func connect(_ device: PrinterDevice) {
        cancelCurrentPrint(reason: .printerChanged)
        stopScan()
        statusMessage = "連線中：\(device.name)"
        connectedPeripheral = device.peripheral
        device.peripheral.delegate = self
        centralManager.connect(device.peripheral, options: nil)
    }

    func reconnectSavedPrinter() {
        guard let savedPrinterId,
              let uuid = UUID(uuidString: savedPrinterId) else {
            statusMessage = "尚未選擇印表機"
            return
        }

        let peripherals = centralManager.retrievePeripherals(withIdentifiers: [uuid])
        guard let peripheral = peripherals.first else {
            statusMessage = "找不到已儲存的印表機，請重新掃描"
            return
        }

        let name = peripheral.name ?? savedPrinterName ?? "未知裝置"
        connect(PrinterDevice(
            id: peripheral.identifier.uuidString,
            name: name,
            rssi: 0,
            peripheral: peripheral
        ))
    }

    func disconnect() {
        cancelCurrentPrint(reason: .connectionLost)
        guard let connectedPeripheral else { return }
        centralManager.cancelPeripheralConnection(connectedPeripheral)
    }

    func clearSavedPrinter() {
        UserDefaults.standard.removeObject(forKey: savedPrinterIdKey)
        UserDefaults.standard.removeObject(forKey: savedPrinterNameKey)
        savedPrinterId = nil
        savedPrinterName = nil
        statusMessage = "已清除印表機設定"
    }

    func testPrint() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            let bytes: [UInt8] = [
                0x1B, 0x40,
                0x54, 0x45, 0x53, 0x54, 0x20, 0x50, 0x52, 0x49, 0x4E, 0x54,
                0x0A, 0x0A, 0x0A,
                0x1B, 0x4A, 0x64
            ]

            do {
                try await send(Data(bytes), label: "測試列印")
            } catch {
                statusMessage = error.localizedDescription
            }
        }
    }

    func print(_ job: PrintJob) async throws {
        let data = try ReceiptRenderer().render(job: job)
        try await send(data, label: job.invoiceNumber)
    }

    private func savePrinter(id: String, name: String) {
        UserDefaults.standard.set(id, forKey: savedPrinterIdKey)
        UserDefaults.standard.set(name, forKey: savedPrinterNameKey)
        savedPrinterId = id
        savedPrinterName = name
    }

    private func send(_ data: Data, label: String) async throws {
        guard let peripheral = connectedPeripheral else {
            throw PrinterError.notConnected
        }

        guard let printCharacteristic else {
            peripheral.discoverServices([printerServiceUUID])
            throw PrinterError.notReady
        }

        guard currentPrintContinuation == nil else {
            throw PrinterError.busy
        }

        guard let writeType = preferredWriteType(for: printCharacteristic) else {
            throw PrinterError.unsupportedCharacteristic
        }

        let chunkSize = max(1, min(peripheral.maximumWriteValueLength(for: writeType), 120))
        let chunks = stride(from: 0, to: data.count, by: chunkSize).map { start -> Data in
            let end = min(start + chunkSize, data.count)
            return data.subdata(in: start..<end)
        }

        isPrinting = true
        currentPrintLabel = label
        currentPrintChunks = chunks
        currentPrintChunkIndex = 0
        currentWriteType = writeType
        isAwaitingWriteResponse = false
        statusMessage = "傳送中：\(label)"

        try await withCheckedThrowingContinuation { continuation in
            currentPrintContinuation = continuation
            pumpWriteQueue()
        }
    }

    private func preferredWriteType(for characteristic: CBCharacteristic) -> CBCharacteristicWriteType? {
        if characteristic.properties.contains(.writeWithoutResponse) {
            return .withoutResponse
        }
        if characteristic.properties.contains(.write) {
            return .withResponse
        }
        return nil
    }

    private func pumpWriteQueue() {
        guard currentPrintContinuation != nil else { return }
        guard let peripheral = connectedPeripheral,
              let characteristic = printCharacteristic,
              let writeType = currentWriteType else {
            finishCurrentPrint(with: .failure(PrinterError.connectionLost))
            return
        }

        if currentPrintChunkIndex >= currentPrintChunks.count, !isAwaitingWriteResponse {
            let label = currentPrintLabel ?? "列印任務"
            statusMessage = "已送至印表機：\(label)"
            finishCurrentPrint(with: .success(()))
            return
        }

        switch writeType {
        case .withResponse:
            guard !isAwaitingWriteResponse, currentPrintChunkIndex < currentPrintChunks.count else { return }
            isAwaitingWriteResponse = true
            let chunk = currentPrintChunks[currentPrintChunkIndex]
            peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
        case .withoutResponse:
            while currentPrintChunkIndex < currentPrintChunks.count {
                guard peripheral.canSendWriteWithoutResponse else { return }
                let chunk = currentPrintChunks[currentPrintChunkIndex]
                peripheral.writeValue(chunk, for: characteristic, type: .withoutResponse)
                currentPrintChunkIndex += 1
                if currentPrintChunkIndex.isMultiple(of: 8) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) {
                        self.pumpWriteQueue()
                    }
                    return
                }
            }
            pumpWriteQueue()
        @unknown default:
            finishCurrentPrint(with: .failure(PrinterError.unsupportedCharacteristic))
        }
    }

    private func finishCurrentPrint(with result: Result<Void, Error>) {
        let continuation = currentPrintContinuation
        currentPrintContinuation = nil
        currentPrintChunks = []
        currentPrintChunkIndex = 0
        currentWriteType = nil
        isAwaitingWriteResponse = false
        currentPrintLabel = nil
        isPrinting = false

        switch result {
        case .success:
            continuation?.resume()
        case .failure(let error):
            continuation?.resume(throwing: error)
        }
    }

    private func cancelCurrentPrint(reason: PrinterError) {
        guard currentPrintContinuation != nil else { return }
        statusMessage = reason.localizedDescription
        finishCurrentPrint(with: .failure(reason))
    }

    private func updateBluetoothState(_ state: CBManagerState) {
        switch state {
        case .unknown:
            bluetoothState = "未知"
        case .resetting:
            bluetoothState = "重置中"
        case .unsupported:
            bluetoothState = "不支援"
        case .unauthorized:
            bluetoothState = "未授權"
        case .poweredOff:
            bluetoothState = "已關閉"
            cancelCurrentPrint(reason: .connectionLost)
        case .poweredOn:
            bluetoothState = "可用"
        @unknown default:
            bluetoothState = "未知"
        }
    }
}

enum PrinterError: LocalizedError {
    case notConnected
    case notReady
    case busy
    case unsupportedCharacteristic
    case connectionLost
    case appMovedToBackground
    case printerChanged

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "請先連線印表機"
        case .notReady:
            return "印表機尚未準備好"
        case .busy:
            return "目前正在傳送另一張發票"
        case .unsupportedCharacteristic:
            return "此印表機不支援可用的列印模式"
        case .connectionLost:
            return "列印傳送中斷，請重新列印"
        case .appMovedToBackground:
            return "App 進入背景，已取消當前列印"
        case .printerChanged:
            return "已切換印表機，當前列印已取消"
        }
    }
}

extension PrinterManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        updateBluetoothState(central.state)
        if central.state != .poweredOn {
            isScanning = false
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let name = peripheral.name
            ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? "未知裝置"
        let id = peripheral.identifier.uuidString
        let device = PrinterDevice(
            id: id,
            name: name,
            rssi: RSSI.intValue,
            peripheral: peripheral
        )

        if let index = devices.firstIndex(where: { $0.id == id }) {
            devices[index] = device
        } else {
            devices.append(device)
        }

        devices.sort { first, second in
            if first.name == "未知裝置" { return false }
            if second.name == "未知裝置" { return true }
            return first.name.localizedStandardCompare(second.name) == .orderedAscending
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        let id = peripheral.identifier.uuidString
        let name = peripheral.name ?? "未知裝置"
        connectedPrinterId = id
        connectedPrinterName = name
        connectedPeripheral = peripheral
        printCharacteristic = nil
        peripheral.delegate = self
        savePrinter(id: id, name: name)
        statusMessage = "已連線：\(name)，正在尋找列印服務"
        peripheral.discoverServices([printerServiceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        cancelCurrentPrint(reason: .connectionLost)
        connectedPeripheral = nil
        statusMessage = error?.localizedDescription ?? "連線失敗"
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        cancelCurrentPrint(reason: .connectionLost)
        connectedPeripheral = nil
        connectedPrinterId = nil
        connectedPrinterName = nil
        printCharacteristic = nil
        statusMessage = error?.localizedDescription ?? "已中斷連線"
    }
}

extension PrinterManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            statusMessage = "尋找列印服務失敗：\(error.localizedDescription)"
            return
        }

        guard let service = peripheral.services?.first(where: { $0.uuid == printerServiceUUID }) else {
            statusMessage = "未找到打印服務"
            return
        }

        peripheral.discoverCharacteristics([printerCharacteristicUUID], for: service)
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        if let error {
            statusMessage = "尋找列印特徵值失敗：\(error.localizedDescription)"
            return
        }

        guard let characteristic = service.characteristics?.first(where: { $0.uuid == printerCharacteristicUUID }) else {
            statusMessage = "未找到打印特徵值"
            return
        }

        printCharacteristic = characteristic
        statusMessage = "印表機已準備好"
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard characteristic.uuid == printerCharacteristicUUID else { return }

        if let error {
            statusMessage = "列印傳送失敗：\(error.localizedDescription)"
            finishCurrentPrint(with: .failure(error))
            return
        }

        guard currentWriteType == .withResponse else { return }
        isAwaitingWriteResponse = false
        currentPrintChunkIndex += 1
        pumpWriteQueue()
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard currentWriteType == .withoutResponse else { return }
        pumpWriteQueue()
    }
}
