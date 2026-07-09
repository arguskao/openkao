import Foundation

enum ReceiptPaperWidth {
    case mm58
    case mm80

    var textColumns: Int {
        switch self {
        case .mm58:
            return 32
        case .mm80:
            return 48
        }
    }
}

struct ReceiptRenderer {
    private let paperWidth: ReceiptPaperWidth
    private let columns: Int

    init(paperWidth: ReceiptPaperWidth = .mm58) {
        self.paperWidth = paperWidth
        columns = paperWidth.textColumns
    }

    func render(job: PrintJob) -> Data {
        var data = Data()
        data.append(contentsOf: ESC.initialize)
        data.append(contentsOf: ESC.selectBig5)
        data.append(contentsOf: ESC.alignCenter)
        data.appendLine(job.sellerName ?? "電子發票證明聯")
        data.appendLine("電子發票證明聯")
        data.appendLine("114年07-08月")
        data.append(contentsOf: ESC.doubleSize)
        data.appendLine(job.invoiceNumber)
        data.append(contentsOf: ESC.normalSize)
        data.appendLine(DateFormatter.receiptDate.string(from: job.issuedAt))
        data.append(contentsOf: ESC.alignLeft)
        data.appendLine(rule())
        data.appendLine(twoColumn("隨機碼 \(job.randomNumber)", "總計 \(job.totalAmount)"))
        data.appendLine(twoColumn("賣方 \(job.sellerIdentifier ?? "--------")", "買方 \(job.buyerIdentifier ?? "--------")"))
        data.appendLine(rule())
        data.appendLine("品名")
        data.appendLine(twoColumn("數量 x 單價", "小計"))

        for item in job.items {
            appendWrapped(item.name, to: &data)
            data.appendLine(twoColumn("\(item.quantity) x \(item.unitPrice)", "\(item.amount)"))
        }

        data.appendLine(rule())
        data.appendLine(twoColumn("合計", "\(job.totalAmount)"))

        if let qrCodePayload = job.qrCodePayload, !qrCodePayload.isEmpty {
            data.appendLine("")
            data.append(contentsOf: ESC.alignCenter)
            data.appendQRCode(qrCodePayload)
        }

        if let barcodePayload = job.barcodePayload, !barcodePayload.isEmpty {
            data.appendLine("")
            data.appendBarcodeCode128(barcodePayload)
        }

        data.append(contentsOf: ESC.alignLeft)
        data.appendLine("")
        data.appendLine("")
        data.append(contentsOf: ESC.feed(points: 120))
        return data
    }

    private func appendWrapped(_ text: String, to data: inout Data) {
        let sanitized = text.receiptSafeText
        var current = ""

        for character in sanitized {
            let next = current + String(character)
            if next.receiptWidth > columns {
                data.appendLine(current)
                current = String(character)
            } else {
                current = next
            }
        }

        if !current.isEmpty {
            data.appendLine(current)
        }
    }

    private func rule() -> String {
        String(repeating: "-", count: columns)
    }

    private func twoColumn(_ left: String, _ right: String) -> String {
        let safeLeft = left.receiptSafeText
        let safeRight = right.receiptSafeText
        let leftWidth = safeLeft.receiptWidth
        let rightWidth = safeRight.receiptWidth
        let spaces = max(1, columns - leftWidth - rightWidth)
        return safeLeft + String(repeating: " ", count: spaces) + safeRight
    }
}

private enum ESC {
    static let initialize: [UInt8] = [0x1B, 0x40]
    static let alignLeft: [UInt8] = [0x1B, 0x61, 0x00]
    static let alignCenter: [UInt8] = [0x1B, 0x61, 0x01]
    static let normalSize: [UInt8] = [0x1D, 0x21, 0x00]
    static let doubleSize: [UInt8] = [0x1D, 0x21, 0x11]
    static let selectBig5: [UInt8] = [0x1C, 0x26]

    static func feed(points: UInt8) -> [UInt8] {
        [0x1B, 0x4A, points]
    }
}

private extension Data {
    mutating func appendLine(_ string: String) {
        appendEncodedText(string)
        append(0x0A)
    }

    mutating func appendEncodedText(_ string: String) {
        if let data = string.data(using: .big5) {
            append(data)
            return
        }

        append(Data(string.receiptSafeText.utf8))
    }

    mutating func appendQRCode(_ payload: String) {
        let data = Data(payload.utf8)
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05])
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31])

        let storeLength = data.count + 3
        append(contentsOf: [0x1D, 0x28, 0x6B, UInt8(storeLength % 256), UInt8(storeLength / 256), 0x31, 0x50, 0x30])
        append(data)
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
    }

    mutating func appendBarcodeCode128(_ payload: String) {
        let bytes = Array(payload.utf8)
        guard bytes.count <= 255 else { return }

        append(contentsOf: [0x1D, 0x48, 0x02])
        append(contentsOf: [0x1D, 0x68, 0x50])
        append(contentsOf: [0x1D, 0x77, 0x02])
        append(contentsOf: [0x1D, 0x6B, 0x49, UInt8(bytes.count)])
        append(contentsOf: bytes)
        append(0x0A)
    }
}

private extension String {
    var receiptSafeText: String {
        map { character in
            String(character).data(using: .big5) == nil ? "?" : String(character)
        }
        .joined()
    }

    var receiptWidth: Int {
        reduce(0) { partialResult, character in
            partialResult + (character.isASCII ? 1 : 2)
        }
    }
}

private extension Character {
    var isASCII: Bool {
        unicodeScalars.allSatisfy(\.isASCII)
    }
}

private extension String.Encoding {
    static let big5 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.big5.rawValue)))
}

private extension DateFormatter {
    static let receiptDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy/MM/dd HH:mm:ss"
        return formatter
    }()
}
