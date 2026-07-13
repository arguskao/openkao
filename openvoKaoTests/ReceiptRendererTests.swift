import XCTest
@testable import openvoKao

final class ReceiptRendererTests: XCTestCase {
    func testRocPeriodAmountsAndLineItems() throws {
        let data = try ReceiptRenderer().render(job: makeJob())

        XCTAssertTrue(data.containsGBKText("115年07-08月"))
        XCTAssertTrue(data.containsGBKText("AB-12345678"))
        XCTAssertFalse(data.containsGBKText("AB12345678"))
        XCTAssertTrue(data.containsGBKText("總計 135"))
        XCTAssertTrue(data.containsGBKText("格式:25"))
        XCTAssertTrue(data.containsGBKText("賣方:12345678"))
        XCTAssertTrue(data.containsGBKText("買方:03741302"))
        XCTAssertTrue(data.containsGBKText("品名"))
        XCTAssertTrue(data.containsGBKText("金額"))
        XCTAssertTrue(data.containsGBKText("銷貨明細單"))
        XCTAssertTrue(data.containsGBKText("買受人統編：03741302"))
        XCTAssertTrue(data.containsGBKText("營業人統編：12345678"))
        XCTAssertTrue(data.containsGBKText("交易時間："))
        XCTAssertTrue(data.containsGBKText("45TX"))
        XCTAssertTrue(data.containsGBKText("90TX"))
        XCTAssertTrue(data.containsGBKText("銷售額(應稅)"))
        XCTAssertTrue(data.containsGBKText("128"))
        XCTAssertTrue(data.containsGBKText("稅額"))
        XCTAssertTrue(data.containsGBKText("7"))
        XCTAssertTrue(data.containsGBKText("90"))
    }

    func testOfficialHeaderUsesRequiredLargeBoldText() throws {
        let data = try ReceiptRenderer().render(job: makeJob())

        XCTAssertTrue(data.containsBytes([
            0x1B, 0x45, 0x01,
            0x1D, 0x21, 0x11,
            0x1C, 0x21, 0x0C
        ]))
        XCTAssertTrue(data.containsBytes([
            0x1D, 0x21, 0x11,
            0x1C, 0x21, 0x0C
        ] + (GBKTestEncoding.data(from: "電子發票證明聯") ?? [])))
        XCTAssertTrue(data.containsBytes([
            0x1D, 0x21, 0x11,
            0x1C, 0x21, 0x0C
        ] + Array("AB-12345678".utf8)))
        XCTAssertTrue(data.containsBytes([
            0x1D, 0x21, 0x00,
            0x1C, 0x21, 0x00,
            0x1B, 0x45, 0x00
        ]))
    }

    func testGBKFallbackReplacesUnsupportedCharacters() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: "奶茶😀", quantity: 1, unitPrice: 45)
        ]
        job.totalAmount = 45

        let data = try ReceiptRenderer().render(job: job)

        XCTAssertTrue(data.containsGBKText("奶茶?"))
        XCTAssertFalse(data.containsBytes(Array("😀".utf8)))
    }

    func testChineseReceiptTextUsesGBKButQrPayloadKeepsUTF8Bytes() throws {
        let payload = "發票左碼-**-測試"
        let utf8 = Data(payload.utf8)
        let gbk = try XCTUnwrap(GBKTestEncoding.data(from: payload))

        XCTAssertEqual(ReceiptRasterizer.qrPayloadData(payload), utf8)
        XCTAssertNotEqual(Array(ReceiptRasterizer.qrPayloadData(payload)), gbk)

        var job = makeJob()
        job.items = [PrintJobItem(id: UUID(), name: "繁體中文商品", quantity: 1, unitPrice: 45)]
        let receipt = try ReceiptRenderer().render(job: job)
        XCTAssertTrue(receipt.containsGBKText("繁體中文商品"))
    }

    func testLongItemNameWrapsWithinReceiptWidth() throws {
        var job = makeJob()
        job.items = [
            PrintJobItem(id: UUID(), name: String(repeating: "超長商品", count: 8), quantity: 1, unitPrice: 100)
        ]
        job.totalAmount = 100

        let data = try ReceiptRenderer().render(job: job)
        let productNameBytes = try XCTUnwrap(GBKTestEncoding.data(from: "超長商品"))
        let wrappedLines = data
            .escposTextLinesForTests
            .filter { $0.containsBytes(productNameBytes) }

        XCTAssertGreaterThan(wrappedLines.count, 1)
        XCTAssertTrue(wrappedLines.allSatisfy { $0.gbkReceiptDisplayWidthForTests <= 12 })
    }

    func testDualQrUsesAmegoCompatibleRasterSizeAndMargin() throws {
        let data = try ReceiptRenderer().render(job: makeJob())
        let images = data.rasterImagesForTests

        XCTAssertEqual(images.count, 2)
        XCTAssertEqual(images[0].widthBytes, 48)
        XCTAssertEqual(images[0].height, 88)
        XCTAssertEqual(images[1].widthBytes, 42)
        XCTAssertEqual(images[1].height, 150)
        XCTAssertGreaterThanOrEqual(images[0].minimumBlackRunWidth, 2)
        XCTAssertTrue(data.containsBytes([
            0x1B, 0x33, 0x1E,
            0x1D, 0x4C, 0x17, 0x00,
            0x1B, 0x21, 0x00,
            0x1B, 0x61, 0x00,
            0x1D, 0x76, 0x30, 0x00, 0x2A, 0x00, 0x96, 0x00
        ]))
        XCTAssertTrue(data.containsBytes([0x1D, 0x4C, 0x00, 0x00]))
        XCTAssertFalse(data.containsBytes([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41]))
        XCTAssertFalse(data.containsBytes([0x1D, 0x6B, 0x49]))
        XCTAssertFalse(data.containsBytes(Array("11508AB123456781234".utf8)))
    }

    func testDualQrCompositeContainsBothSymbols() throws {
        let qrImage = try ReceiptRasterizer.dualQRCode(
            leftPayload: makeJob().leftQRCodePayload!,
            rightPayload: makeJob().rightQRCodePayload!
        )
        let halfWidth = qrImage.width / 2
        var leftBlackDots = 0
        var rightBlackDots = 0

        for y in 0..<qrImage.height {
            for x in 0..<halfWidth where qrImage.isBlack(x: x, y: y) {
                leftBlackDots += 1
            }
            for x in halfWidth..<qrImage.width where qrImage.isBlack(x: x, y: y) {
                rightBlackDots += 1
            }
        }

        XCTAssertGreaterThan(leftBlackDots, 0)
        XCTAssertGreaterThan(rightBlackDots, 0)
    }

    func testLegacySingleQrRemainsCompatible() throws {
        var job = makeJob()
        job.leftQRCodePayload = nil
        job.rightQRCodePayload = nil
        job.qrCodePayload = "LEGACY-QR"
        job.barcodePayload = nil

        let data = try ReceiptRenderer().render(job: job)

        XCTAssertTrue(data.containsBytes([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]))
        XCTAssertTrue(data.containsBytes(Array("LEGACY-QR".utf8)))
    }

    func testConsumerReceiptOmitsSalesDetailEntirely() throws {
        var job = makeJob()
        job.buyerIdentifier = nil

        let data = try ReceiptRenderer().render(job: job)
        let printedText = Data(data.escposTextLinesForTests.flatMap { $0 })

        XCTAssertFalse(printedText.containsGBKText("格式:25"))
        XCTAssertFalse(printedText.containsGBKText("銷售額(應稅)"))
        XCTAssertFalse(printedText.containsGBKText("銷貨明細單"))
        XCTAssertFalse(printedText.containsGBKText("品名"))
        XCTAssertFalse(printedText.containsGBKText("加蛋"))
        XCTAssertFalse(printedText.containsGBKText("奶茶"))
        XCTAssertFalse(printedText.containsGBKText("課稅別"))
        XCTAssertFalse(printedText.containsGBKText("TX"))
    }

    func testReprintAddsReprintMarker() throws {
        var job = makeJob()
        job.isReprint = true

        let data = try ReceiptRenderer().render(job: job)

        XCTAssertTrue(data.containsGBKText("電子發票證明聯 補印"))
    }

    func testUnpairedOfficialQrIsRejected() {
        var job = makeJob()
        job.rightQRCodePayload = nil

        XCTAssertThrowsError(try ReceiptRenderer().render(job: job))
    }

    func testTestPrintContainsTitleBarcodeAndDualQr() throws {
        let data = try ReceiptRenderer().renderTestPrint()

        XCTAssertTrue(data.containsGBKText("電子發票證明聯"))
        XCTAssertTrue(data.containsBytes([
            0x1B, 0x45, 0x01,
            0x1D, 0x21, 0x11,
            0x1C, 0x21, 0x0C
        ]))
        XCTAssertTrue(data.containsBytes([0x1D, 0x76, 0x30, 0x00]))
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
            buyerIdentifier: "03741302",
            totalAmount: 135,
            salesAmount: 128,
            taxAmount: 7,
            invoiceFormatCode: "25",
            isReprint: false,
            items: [
                PrintJobItem(id: UUID(), name: "加蛋", quantity: 3, unitPrice: 15),
                PrintJobItem(id: UUID(), name: "奶茶", quantity: 2, unitPrice: 45)
            ],
            qrCodePayload: nil,
            leftQRCodePayload: "AB123456781150712123400000087000000870000000012345678AMEGOLEFTPAYLOAD",
            rightQRCodePayload: "**AMEDITORIGHTPAYLOAD:2:2:1:加蛋:3:15:奶茶:2:45",
            barcodePayload: "11508AB123456781234",
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

    var rasterImagesForTests: [ESCPosRasterFixture] {
        let bytes = Array(self)
        var images: [ESCPosRasterFixture] = []
        var index = 0

        while index + 7 < bytes.count {
            guard Array(bytes[index..<index + 4]) == [0x1D, 0x76, 0x30, 0x00] else {
                index += 1
                continue
            }
            let widthBytes = Int(bytes[index + 4]) + Int(bytes[index + 5]) * 256
            let height = Int(bytes[index + 6]) + Int(bytes[index + 7]) * 256
            let dataStart = index + 8
            let dataEnd = dataStart + widthBytes * height
            guard widthBytes > 0, height > 0, dataEnd <= bytes.count else { break }
            images.append(ESCPosRasterFixture(
                widthBytes: widthBytes,
                height: height,
                data: Array(bytes[dataStart..<dataEnd])
            ))
            index = dataEnd
        }
        return images
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
                case 0x45, 0x4A, 0x61:
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
                case 0x76 where index + 7 < bytes.count && bytes[index + 2] == 0x30:
                    let widthBytes = Int(bytes[index + 4]) + Int(bytes[index + 5]) * 256
                    let height = Int(bytes[index + 6]) + Int(bytes[index + 7]) * 256
                    index += Swift.min(bytes.count - index, 8 + widthBytes * height)
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

private struct ESCPosRasterFixture {
    let widthBytes: Int
    let height: Int
    let data: [UInt8]

    var minimumBlackRunWidth: Int {
        guard height > 0 else { return 0 }
        let row = data.prefix(widthBytes)
        var bits: [Bool] = []
        for byte in row {
            for bit in 0..<8 {
                bits.append(byte & UInt8(0x80 >> bit) != 0)
            }
        }
        var runs: [Int] = []
        var current = 0
        for isBlack in bits {
            if isBlack {
                current += 1
            } else if current > 0 {
                runs.append(current)
                current = 0
            }
        }
        if current > 0 {
            runs.append(current)
        }
        return runs.min() ?? 0
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
