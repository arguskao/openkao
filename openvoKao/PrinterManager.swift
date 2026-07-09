import Combine
import CoreBluetooth
import Foundation

struct PrinterDevice: Identifiable {
    let id: String
    let name: String
    let rssi: Int
    let peripheral: CBPeripheral
}

final class PrinterManager: NSObject, ObservableObject {
    @Published private(set) var devices: [PrinterDevice] = []
    @Published private(set) var isScanning = false
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

    var isPrinterReady: Bool {
        connectedPeripheral != nil && printCharacteristic != nil
    }

    override init() {
        super.init()
        savedPrinterId = UserDefaults.standard.string(forKey: savedPrinterIdKey)
        savedPrinterName = UserDefaults.standard.string(forKey: savedPrinterNameKey)
        centralManager = CBCentralManager(delegate: self, queue: nil)
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
        guard let peripheral = connectedPeripheral else {
            statusMessage = "請先連線印表機"
            return
        }

        guard let printCharacteristic else {
            statusMessage = "印表機尚未準備好，正在重新尋找列印服務"
            peripheral.discoverServices([printerServiceUUID])
            return
        }

        let bytes: [UInt8] = [
            0x1B, 0x40,
            0x54, 0x45, 0x53, 0x54, 0x20, 0x50, 0x52, 0x49, 0x4E, 0x54,
            0x0A, 0x0A, 0x0A,
            0x1B, 0x4A, 0x64
        ]
        statusMessage = "送出測試列印"
        writeData(Data(bytes), to: printCharacteristic, on: peripheral)
    }

    func print(_ job: PrintJob) throws {
        guard let peripheral = connectedPeripheral else {
            throw PrinterError.notConnected
        }

        guard let printCharacteristic else {
            peripheral.discoverServices([printerServiceUUID])
            throw PrinterError.notReady
        }

        statusMessage = "送出列印：\(job.invoiceNumber)"
        let data = ReceiptRenderer(paperWidth: .mm58).render(job: job)
        writeData(data, to: printCharacteristic, on: peripheral)
    }

    private func savePrinter(id: String, name: String) {
        UserDefaults.standard.set(id, forKey: savedPrinterIdKey)
        UserDefaults.standard.set(name, forKey: savedPrinterNameKey)
        savedPrinterId = id
        savedPrinterName = name
    }

    private func writeData(_ data: Data, to characteristic: CBCharacteristic, on peripheral: CBPeripheral) {
        let chunkSize = 20
        let chunks = stride(from: 0, to: data.count, by: chunkSize).map { start -> Data in
            let end = min(start + chunkSize, data.count)
            return data.subdata(in: start..<end)
        }

        writeChunks(chunks, index: 0, characteristic: characteristic, peripheral: peripheral)
    }

    private func writeChunks(
        _ chunks: [Data],
        index: Int,
        characteristic: CBCharacteristic,
        peripheral: CBPeripheral
    ) {
        guard index < chunks.count else {
            statusMessage = "測試列印已送出"
            return
        }

        peripheral.writeValue(chunks[index], for: characteristic, type: .withoutResponse)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
            self?.writeChunks(chunks, index: index + 1, characteristic: characteristic, peripheral: peripheral)
        }
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

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "請先連線印表機"
        case .notReady:
            return "印表機尚未準備好"
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
        connectedPeripheral = nil
        statusMessage = error?.localizedDescription ?? "連線失敗"
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
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
}
