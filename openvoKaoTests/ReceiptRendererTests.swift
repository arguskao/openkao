import XCTest
@testable import openvoKao

final class ReceiptRendererTests: XCTestCase {
    func testRocPeriodAmountsAndLineItems() throws {
        let data = ReceiptRenderer(paperWidth: .mm58).render(job: makeJob())

        XCTAssertTrue(data.containsGBKText("115年07-08月"))
        XCTAssertTrue(data.containsGBKText("AB12345678"))
        XCTAssertTrue(data.containsGBKText("總計 135"))
        XCTAssertTrue(data.containsGBKText("2 x 45"))
        XCTAssertTrue(data.containsGBKText("90"))
    }

    func testGBKFallbackReplacesUnsupportedCharacters() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: "奶茶😀", quantity: 1, unitPrice: 45)
        ]
        job.totalAmount = 45

        let data = ReceiptRenderer().render(job: job)

        XCTAssertTrue(data.containsGBKText("奶茶?"))
        XCTAssertFalse(data.containsBytes(Array("😀".utf8)))
    }

    func testLongItemNameWrapsWithinReceiptWidth() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: String(repeating: "超長商品", count: 8), quantity: 1, unitPrice: 100)
        ]
        job.totalAmount = 100

        let data = ReceiptRenderer(paperWidth: .mm58).render(job: job)
        let productNameBytes = try XCTUnwrap(GBKTestEncoding.data(from: "超長商品"))
        let wrappedLines = data
            .escposTextLinesForTests
            .filter { $0.containsBytes(productNameBytes) }

        XCTAssertGreaterThan(wrappedLines.count, 1)
        XCTAssertTrue(wrappedLines.allSatisfy { $0.gbkReceiptDisplayWidthForTests <= ReceiptPaperWidth.mm58.textColumns })
    }

    func testQrAndBarcodeByteFixture() {
        let data = ReceiptRenderer().render(job: makeJob())

        XCTAssertTrue(data.containsBytes([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]))
        XCTAssertTrue(data.containsBytes([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]))
        XCTAssertTrue(data.containsBytes([0x1D, 0x6B, 0x49, 0x0A]))
        XCTAssertTrue(data.containsBytes(Array("AB12345678".utf8)))
    }

    private func makeJob() -> PrintJob {
        PrintJob(
            id: UUID(),
            remoteId: "remote-1",
            invoiceNumber: "AB12345678",
            randomNumber: "1234",
            issuedAt: Date(timeIntervalSince1970: 1_783_571_400),
            sellerName: "測試商店",
            sellerIdentifier: "12345678",
            buyerIdentifier: nil,
            totalAmount: 135,
            items: [
                PrintJobItem(id: UUID(), name: "加蛋", quantity: 3, unitPrice: 15),
                PrintJobItem(id: UUID(), name: "奶茶", quantity: 2, unitPrice: 45)
            ],
            qrCodePayload: "QR-FIXTURE",
            barcodePayload: "AB12345678",
            status: .pending,
            lastMessage: nil
        )
    }
}

private extension Data {
    func containsBytes(_ needle: [UInt8]) -> Bool {
        Array(self).containsBytes(needle)
    }

    func containsGBKText(_ text: String) -> Bool {
        guard let bytes = GBKTestEncoding.data(from: text) else { return false }
        return containsBytes(bytes)
    }

    var escposTextLinesForTests: [[UInt8]] {
        stripEscPosCommandsForTests()
            .split(separator: 0x0A)
            .map(Array.init)
            .filter { !$0.isEmpty }
    }

    private func stripEscPosCommandsForTests() -> [UInt8] {
        let bytes = Array(self)
        var output: [UInt8] = []
        var index = 0

        while index < bytes.count {
            switch bytes[index] {
            case 0x1B:
                guard index + 1 < bytes.count else { index += 1; continue }
                switch bytes[index + 1] {
                case 0x40:
                    index += 2
                case 0x4A, 0x61:
                    index += 3
                default:
                    index += 2
                }
            case 0x1C:
                if index + 1 < bytes.count, bytes[index + 1] == 0x26 {
                    index += 2
                } else {
                    index += 1
                }
            case 0x1D:
                guard index + 1 < bytes.count else { index += 1; continue }
                switch bytes[index + 1] {
                case 0x21, 0x48, 0x68, 0x77:
                    index += 3
                case 0x28 where index + 4 < bytes.count && bytes[index + 2] == 0x6B:
                    let length = Int(bytes[index + 3]) + Int(bytes[index + 4]) * 256
                    index += Swift.min(bytes.count - index, 5 + length)
                case 0x6B where index + 3 < bytes.count && bytes[index + 2] == 0x49:
                    let length = Int(bytes[index + 3])
                    index += Swift.min(bytes.count - index, 4 + length)
                default:
                    index += 2
                }
            default:
                output.append(bytes[index])
                index += 1
            }
        }

        return output
    }
}

private extension Array where Element == UInt8 {
    func containsBytes(_ needle: [UInt8]) -> Bool {
        guard !needle.isEmpty, count >= needle.count else { return false }
        return indices.dropLast(needle.count - 1).contains { index in
            Array(self[index..<index + needle.count]) == needle
        }
    }

    var gbkReceiptDisplayWidthForTests: Int {
        var width = 0
        var index = 0

        while index < count {
            if self[index] < 0x80 {
                width += 1
                index += 1
            } else {
                width += 2
                index += 2
            }
        }

        return width
    }
}

private enum GBKTestEncoding {
    private static let encoding = CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)

    static func data(from string: String) -> [UInt8]? {
        guard let data = CFStringCreateExternalRepresentation(nil, string as CFString, encoding, 0) as Data? else {
            return nil
        }
        return Array(data)
    }
}
