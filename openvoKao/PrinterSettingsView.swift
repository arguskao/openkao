import SwiftUI

struct PrinterSettingsView: View {
    @EnvironmentObject private var printerManager: PrinterManager

    var body: some View {
        NavigationView {
            Form {
                Section("連線狀態") {
                    ReadOnlyRow(title: "藍牙", value: printerManager.bluetoothState)
                    ReadOnlyRow(title: "目前印表機", value: printerManager.connectedPrinterName ?? "未連線")
                    ReadOnlyRow(title: "已儲存", value: printerManager.savedPrinterName ?? "無")
                    ReadOnlyRow(title: "紙張", value: printerManager.paperWidth.title)

                    if let message = printerManager.statusMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section("操作") {
                    Picker("紙張寬度", selection: Binding(
                        get: { printerManager.paperWidth },
                        set: { printerManager.updatePaperWidth($0) }
                    )) {
                        Text("58mm").tag(ReceiptPaperWidth.mm58)
                        Text("80mm").tag(ReceiptPaperWidth.mm80)
                    }

                    Button {
                        printerManager.isScanning
                            ? printerManager.stopScan()
                            : printerManager.startScan()
                    } label: {
                        Label(
                            printerManager.isScanning ? "停止掃描" : "掃描印表機",
                            systemImage: printerManager.isScanning ? "stop.circle" : "dot.radiowaves.left.and.right"
                        )
                    }

                    Button {
                        printerManager.reconnectSavedPrinter()
                    } label: {
                        Label("重新連線已儲存印表機", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(printerManager.savedPrinterId == nil)

                    Button {
                        printerManager.testPrint()
                    } label: {
                        Label("測試列印", systemImage: "printer")
                    }
                    .disabled(printerManager.connectedPrinterId == nil)

                    Button(role: .destructive) {
                        printerManager.disconnect()
                    } label: {
                        Label("中斷連線", systemImage: "xmark.circle")
                    }
                    .disabled(printerManager.connectedPrinterId == nil)

                    Button(role: .destructive) {
                        printerManager.clearSavedPrinter()
                    } label: {
                        Label("清除已儲存印表機", systemImage: "trash")
                    }
                    .disabled(printerManager.savedPrinterId == nil)
                }

                Section("掃描結果") {
                    if printerManager.devices.isEmpty {
                        Text(printerManager.isScanning ? "正在搜尋附近裝置" : "尚未掃描")
                            .foregroundColor(.secondary)
                    }

                    ForEach(printerManager.devices) { device in
                        Button {
                            printerManager.connect(device)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(device.name)
                                        .foregroundColor(.primary)
                                    Text(device.id)
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                }

                                Spacer()

                                Text("\(device.rssi)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("印表機設定")
        }
    }
}

#Preview {
    PrinterSettingsView()
        .environmentObject(PrinterManager())
}
