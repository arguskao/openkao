import Foundation

enum ReceiptLayout {
    static let paperTitle = "58mm"
    static let textColumns = 32
    static let printableDots = 384
    static let qrCanvasDots = 184
    static let qrGapDots = 8
    static let barcodeHeightDots = 88
}

struct ReceiptRenderer {
    private let columns = ReceiptLayout.textColumns

    func render(job: PrintJob) throws -> Data {
        var data = Data()
        let periodText = invoicePeriodText(for: job.issuedAt)
        data.append(contentsOf: ESC.initialize)
        data.append(contentsOf: ESC.selectChineseCharacterMode)
        data.append(contentsOf: ESC.alignCenter)
        data.appendLine(job.sellerName ?? "電子發票證明聯")
        data.append(contentsOf: ESC.emphasisOn)
        data.append(contentsOf: ESC.doubleHeight)
        data.appendLine(receiptTitle(for: job))
        data.appendLine(periodText)
        data.append(contentsOf: ESC.doubleSize)
        data.appendLine(displayInvoiceNumber(job.invoiceNumber))
        data.append(contentsOf: ESC.normalSize)
        data.append(contentsOf: ESC.emphasisOff)
        data.appendLine(invoiceDateLine(for: job))
        data.append(contentsOf: ESC.alignLeft)
        data.appendLine(twoColumn("隨機碼 \(job.randomNumber)", "總計 \(job.totalAmount)"))
        data.appendLine(sellerBuyerLine(for: job))

        if let barcodePayload = job.barcodePayload, !barcodePayload.isEmpty {
            data.appendLine("")
            data.append(contentsOf: ESC.alignCenter)
            data.appendRasterImage(try ReceiptRasterizer.code128(
                payload: barcodePayload
            ))
        }

        switch (job.leftQRCodePayload, job.rightQRCodePayload) {
        case let (left?, right?) where !left.isEmpty && !right.isEmpty:
            data.appendLine("")
            data.append(contentsOf: ESC.alignCenter)
            data.appendRasterImage(try ReceiptRasterizer.dualQRCode(
                leftPayload: left,
                rightPayload: right
            ))
        case (nil, nil), ("", ""):
            if let qrCodePayload = job.qrCodePayload, !qrCodePayload.isEmpty {
                data.appendLine("")
                data.append(contentsOf: ESC.alignCenter)
                data.appendQRCode(qrCodePayload)
            }
        default:
            throw ReceiptRasterError.invalidQRCode
        }

        data.append(contentsOf: ESC.alignLeft)
        data.appendLine(rule())
        if let sellerName = job.sellerName, !sellerName.isEmpty {
            data.appendLine(sellerName)
            data.appendLine("")
        }
        data.appendLine(itemHeader(for: job))

        for item in job.items {
            appendItem(item, to: &data)
        }

        if isBusinessBuyer(job) {
            let tax = job.taxAmount ?? businessTaxAmount(for: job.totalAmount)
            let sales = job.salesAmount ?? (job.totalAmount - tax)
            data.appendLine("")
            data.appendLine(twoColumn("銷售額(應稅)", "\(sales)"))
            data.appendLine(twoColumn("稅額", "\(tax)"))
            data.appendLine(twoColumn("總計", "\(job.totalAmount)"))
        } else {
            data.appendLine(rule())
            data.appendLine(twoColumn("總計", "\(job.totalAmount)"))
            data.appendLine(twoColumn("課稅別", "TX"))
        }

        data.appendLine("")
        data.appendLine("")
        data.append(contentsOf: ESC.feed(points: 120))
        return data
    }

    private func appendItem(_ item: PrintJobItem, to data: inout Data) {
        let name = item.name.receiptGBKSafeText
        let quantity = "\(item.quantity)"
        let unitPrice = "\(item.unitPrice)"
        let amount = "\(item.amount)"
        if name.receiptWidth > 12 {
            appendWrapped(name, to: &data)
            data.appendLine(fourColumn("", quantity, unitPrice, amount))
            return
        }

        let compactLine = fourColumn(name, quantity, unitPrice, amount)
        if compactLine.receiptWidth <= columns {
            data.appendLine(compactLine)
            return
        }

        appendWrapped(name, to: &data)
        data.appendLine(fourColumn("", quantity, unitPrice, amount))
    }

    private func appendWrapped(_ text: String, to data: inout Data) {
        let sanitized = text.receiptGBKSafeText
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

    private func invoiceDateLine(for job: PrintJob) -> String {
        let date = DateFormatter.receiptDate.string(from: job.issuedAt)
        guard isBusinessBuyer(job) else {
            return date
        }
        return twoColumn(date, "格式:\(job.invoiceFormatCode ?? "25")")
    }

    private func receiptTitle(for job: PrintJob) -> String {
        job.isReprint == true ? "電子發票證明聯 補印" : "電子發票證明聯"
    }

    private func displayInvoiceNumber(_ invoiceNumber: String) -> String {
        let trimmed = invoiceNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 10 else { return trimmed }
        let prefix = trimmed.prefix(2)
        let suffix = trimmed.dropFirst(2)
        guard prefix.allSatisfy({ $0.isLetter }), suffix.allSatisfy({ $0.isNumber }) else {
            return trimmed
        }
        return "\(prefix)-\(suffix)"
    }

    private func sellerBuyerLine(for job: PrintJob) -> String {
        let seller = "賣方:\(job.sellerIdentifier ?? "--------")"
        guard let buyerIdentifier = job.buyerIdentifier, !buyerIdentifier.isEmpty else {
            return seller
        }
        return twoColumn(seller, "買方:\(buyerIdentifier)")
    }

    private func itemHeader(for job: PrintJob) -> String {
        isBusinessBuyer(job)
            ? fourColumn("品名", "數量", "單價", "金額")
            : "品名、數量、單價、金額"
    }

    private func isBusinessBuyer(_ job: PrintJob) -> Bool {
        guard let buyerIdentifier = job.buyerIdentifier else { return false }
        return !buyerIdentifier.isEmpty
    }

    private func businessTaxAmount(for totalAmount: Int) -> Int {
        totalAmount - Int((Double(totalAmount) / 1.05).rounded())
    }

    private func fourColumn(_ name: String, _ quantity: String, _ unitPrice: String, _ amount: String) -> String {
        let safeName = name.receiptGBKSafeText.truncatedToReceiptWidth(12)
        let safeQuantity = quantity.receiptGBKSafeText.truncatedToReceiptWidth(4)
        let safeUnitPrice = unitPrice.receiptGBKSafeText.truncatedToReceiptWidth(6)
        let safeAmount = amount.receiptGBKSafeText.truncatedToReceiptWidth(8)
        return safeName.paddedReceiptRight(to: 14)
            + safeQuantity.paddedReceiptLeft(to: 4)
            + safeUnitPrice.paddedReceiptLeft(to: 6)
            + safeAmount.paddedReceiptLeft(to: 8)
    }

    private func twoColumn(_ left: String, _ right: String) -> String {
        let safeLeft = left.receiptGBKSafeText
        let safeRight = right.receiptGBKSafeText
        let leftWidth = safeLeft.receiptWidth
        let rightWidth = safeRight.receiptWidth
        if leftWidth + 1 + rightWidth <= columns {
            let spaces = max(1, columns - leftWidth - rightWidth)
            return safeLeft + String(repeating: " ", count: spaces) + safeRight
        }

        let maxLeftWidth = max(1, columns - rightWidth - 1)
        let truncatedLeft = safeLeft.truncatedToReceiptWidth(maxLeftWidth)
        let spaces = max(1, columns - truncatedLeft.receiptWidth - rightWidth)
        return truncatedLeft + String(repeating: " ", count: spaces) + safeRight
    }

    private func invoicePeriodText(for issuedAt: Date) -> String {
        let calendar = Calendar(identifier: .gregorian)
        let year = calendar.component(.year, from: issuedAt) - 1911
        let month = calendar.component(.month, from: issuedAt)
        let startMonth = month.isMultiple(of: 2) ? month - 1 : month
        let endMonth = startMonth + 1
        return String(format: "%d年%02d-%02d月", year, startMonth, endMonth)
    }
}

private enum ESC {
    static let initialize: [UInt8] = [0x1B, 0x40]
    static let alignLeft: [UInt8] = [0x1B, 0x61, 0x00]
    static let alignCenter: [UInt8] = [0x1B, 0x61, 0x01]
    static let normalSize: [UInt8] = [0x1D, 0x21, 0x00]
    static let doubleHeight: [UInt8] = [0x1D, 0x21, 0x10]
    static let doubleSize: [UInt8] = [0x1D, 0x21, 0x11]
    static let emphasisOn: [UInt8] = [0x1B, 0x45, 0x01]
    static let emphasisOff: [UInt8] = [0x1B, 0x45, 0x00]
    static let selectChineseCharacterMode: [UInt8] = [0x1C, 0x26]

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
        let safe = string.receiptGBKSafeText
        if let data = ChinesePrinterEncoding.data(from: safe) {
            append(data)
            return
        }

        append(Data(safe.utf8))
    }

    mutating func appendQRCode(_ payload: String) {
        let data = Data(payload.utf8)
        guard data.count <= 7089 else { return }

        append(contentsOf: [0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05])
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31])

        let storeLength = data.count + 3
        guard storeLength <= 65535 else { return }
        let low = UInt8(storeLength & 0xFF)
        let high = UInt8((storeLength >> 8) & 0xFF)
        append(contentsOf: [0x1D, 0x28, 0x6B, low, high, 0x31, 0x50, 0x30])
        append(data)
        append(contentsOf: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
    }

    mutating func appendRasterImage(_ image: ESCPosRasterImage) {
        let bytesPerRow = (image.width + 7) / 8
        guard bytesPerRow <= 65535, image.height <= 65535 else { return }
        append(contentsOf: [
            0x1D, 0x76, 0x30, 0x00,
            UInt8(bytesPerRow & 0xFF),
            UInt8((bytesPerRow >> 8) & 0xFF),
            UInt8(image.height & 0xFF),
            UInt8((image.height >> 8) & 0xFF)
        ])
        append(contentsOf: image.bytes)
        append(0x0A)
    }
}

private extension String {
    var receiptGBKSafeText: String {
        map { character in
            ChinesePrinterEncoding.canEncode(String(character)) ? String(character) : "?"
        }
        .joined()
    }

    var receiptWidth: Int {
        reduce(0) { partialResult, character in
            partialResult + (character.isASCII ? 1 : 2)
        }
    }

    func truncatedToReceiptWidth(_ maxWidth: Int) -> String {
        guard maxWidth > 0 else { return "" }
        var output = ""

        for character in self {
            let next = output + String(character)
            if next.receiptWidth > maxWidth {
                break
            }
            output = next
        }

        return output
    }

    func paddedReceiptLeft(to width: Int) -> String {
        let padding = max(0, width - receiptWidth)
        return String(repeating: " ", count: padding) + self
    }

    func paddedReceiptRight(to width: Int) -> String {
        let padding = max(0, width - receiptWidth)
        return self + String(repeating: " ", count: padding)
    }
}

private extension Character {
    var isASCII: Bool {
        unicodeScalars.allSatisfy(\.isASCII)
    }
}

private enum ChinesePrinterEncoding {
    private static let encoding = CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)

    static func data(from string: String) -> Data? {
        CFStringCreateExternalRepresentation(nil, string as CFString, encoding, 0) as Data?
    }

    static func canEncode(_ string: String) -> Bool {
        guard let data = data(from: string) else { return false }
        return data.count <= 2
    }
}

private extension DateFormatter {
    static let receiptDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}
