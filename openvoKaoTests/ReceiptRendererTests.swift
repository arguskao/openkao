import XCTest
@testable import openvoKao

final class ReceiptRendererTests: XCTestCase {
    func testRocPeriodAmountsAndLineItems() throws {
        let data = ReceiptRenderer(paperWidth: .mm58).render(job: makeJob())
        let text = try XCTUnwrap(String(data: data, encoding: .big5ForTests))

        XCTAssertTrue(text.contains("115年07-08月"))
        XCTAssertTrue(text.contains("AB12345678"))
        XCTAssertTrue(text.contains("總計 135"))
        XCTAssertTrue(text.contains("2 x 45"))
        XCTAssertTrue(text.contains("90"))
    }

    func testBig5FallbackReplacesUnsupportedCharacters() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: "奶茶😀", quantity: 1, unitPrice: 45)
        ]
        job.totalAmount = 45

        let text = try XCTUnwrap(String(data: ReceiptRenderer().render(job: job), encoding: .big5ForTests))

        XCTAssertTrue(text.contains("奶茶?"))
        XCTAssertFalse(text.contains("😀"))
    }

    func testLongItemNameWrapsWithinReceiptWidth() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: String(repeating: "超長商品", count: 8), quantity: 1, unitPrice: 100)
        ]
        job.totalAmount = 100

        let text = try XCTUnwrap(String(data: ReceiptRenderer(paperWidth: .mm58).render(job: job), encoding: .big5ForTests))
        let wrappedLines = text
            .split(separator: "\n")
            .map(String.init)
            .filter { $0.contains("超長商品") }

        XCTAssertGreaterThan(wrappedLines.count, 1)
        XCTAssertTrue(wrappedLines.allSatisfy { $0.receiptDisplayWidthForTests <= ReceiptPaperWidth.mm58.textColumns })
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
        guard !needle.isEmpty, count >= needle.count else { return false }
        return withUnsafeBytes { haystackBuffer in
            let haystack = Array(haystackBuffer)
            return haystack.indices.dropLast(needle.count - 1).contains { index in
                Array(haystack[index..<index + needle.count]) == needle
            }
        }
    }
}

private extension String {
    var receiptDisplayWidthForTests: Int {
        reduce(0) { width, character in
            width + (character.unicodeScalars.allSatisfy(\.isASCII) ? 1 : 2)
        }
    }
}

private extension String.Encoding {
    static let big5ForTests = String.Encoding(
        rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.big5.rawValue))
    )
}
