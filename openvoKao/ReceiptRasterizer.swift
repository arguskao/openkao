import CoreImage
import Foundation

enum ReceiptRasterError: LocalizedError {
    case invalidQRCode
    case invalidBarcode
    case imageTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidQRCode:
            return "QRCode 資料無法產生列印圖像。"
        case .invalidBarcode:
            return "一維條碼資料無法產生列印圖像。"
        case .imageTooLarge:
            return "條碼圖像超出目前紙張可列印範圍。"
        }
    }
}

struct ESCPosRasterImage {
    let width: Int
    let height: Int
    private(set) var bytes: [UInt8]

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        bytes = Array(repeating: 0, count: ((width + 7) / 8) * height)
    }

    mutating func fillBlack(x: Int, y: Int, width: Int, height: Int) {
        guard width > 0, height > 0 else { return }
        let maxX = Swift.min(self.width, x + width)
        let maxY = Swift.min(self.height, y + height)
        guard x >= 0, y >= 0, x < maxX, y < maxY else { return }

        let bytesPerRow = (self.width + 7) / 8
        for row in y..<maxY {
            for column in x..<maxX {
                bytes[row * bytesPerRow + column / 8] |= UInt8(0x80 >> (column % 8))
            }
        }
    }

    func isBlack(x: Int, y: Int) -> Bool {
        guard x >= 0, y >= 0, x < width, y < height else { return false }
        let bytesPerRow = (width + 7) / 8
        return bytes[y * bytesPerRow + x / 8] & UInt8(0x80 >> (x % 8)) != 0
    }
}

enum ReceiptRasterizer {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])
    private static let quietZoneModules = 4

    static func qrPayloadData(_ payload: String) -> Data {
        Data(payload.utf8)
    }

    static func dualQRCode(
        leftPayload: String,
        rightPayload: String
    ) throws -> ESCPosRasterImage {
        let left = try qrMatrix(payload: leftPayload)
        let right = try qrMatrix(payload: rightPayload)
        let canvasSize = ReceiptLayout.qrCanvasDots
        let gap = ReceiptLayout.qrGapDots
        let requiredModules = max(left.width, right.width) + quietZoneModules * 2
        let moduleScale = canvasSize / requiredModules
        guard moduleScale >= 1 else {
            throw ReceiptRasterError.imageTooLarge
        }

        let pairWidth = canvasSize * 2 + gap
        let pairOriginX = (ReceiptLayout.qrImageWidthDots - pairWidth) / 2
        guard pairOriginX >= 0 else {
            throw ReceiptRasterError.imageTooLarge
        }

        var output = ESCPosRasterImage(width: ReceiptLayout.qrImageWidthDots, height: canvasSize)
        drawQRMatrix(left, in: &output, canvasX: pairOriginX, canvasSize: canvasSize, scale: moduleScale)
        drawQRMatrix(right, in: &output, canvasX: pairOriginX + canvasSize + gap, canvasSize: canvasSize, scale: moduleScale)
        return output
    }

    static func code128(payload: String) throws -> ESCPosRasterImage {
        let symbols = try code128Symbols(for: payload)
        let symbolModules = symbols.reduce(0) { total, symbol in
            total + code128Patterns[symbol].reduce(0) { $0 + Int(String($1))! }
        }
        let minimumModuleWidth = 2
        let maximumQuietZone = 10
        let availableModules = ReceiptLayout.printableDots / minimumModuleWidth
        let quietZone = min(maximumQuietZone, (availableModules - symbolModules) / 2)
        guard quietZone >= 1 else {
            throw ReceiptRasterError.imageTooLarge
        }
        let totalModules = symbolModules + quietZone * 2
        let horizontalScale = min(ReceiptLayout.printableDots / totalModules, 3)
        guard horizontalScale >= minimumModuleWidth else {
            throw ReceiptRasterError.imageTooLarge
        }
        let barcodeWidth = totalModules * horizontalScale
        let originX = (ReceiptLayout.printableDots - barcodeWidth) / 2
        let height = ReceiptLayout.barcodeHeightDots
        var output = ESCPosRasterImage(width: ReceiptLayout.printableDots, height: height)

        var moduleX = quietZone
        for symbol in symbols {
            for (index, character) in code128Patterns[symbol].enumerated() {
                guard let width = character.wholeNumberValue else {
                    throw ReceiptRasterError.invalidBarcode
                }
                if index.isMultiple(of: 2) {
                    output.fillBlack(
                        x: originX + moduleX * horizontalScale,
                        y: 0,
                        width: width * horizontalScale,
                        height: height
                    )
                }
                moduleX += width
            }
        }
        return output
    }

    private static func code128Symbols(for payload: String) throws -> [Int] {
        let characters = Array(payload.unicodeScalars)
        guard !characters.isEmpty,
              characters.allSatisfy({ (32...126).contains(Int($0.value)) }) else {
            throw ReceiptRasterError.invalidBarcode
        }

        var symbols: [Int] = []
        var index = 0
        var usingCodeC = digitRunLength(in: characters, from: 0) >= 4
        symbols.append(usingCodeC ? 105 : 104)

        while index < characters.count {
            let digitRun = digitRunLength(in: characters, from: index)
            if usingCodeC {
                if digitRun >= 2 {
                    let first = Int(characters[index].value - 48)
                    let second = Int(characters[index + 1].value - 48)
                    symbols.append(first * 10 + second)
                    index += 2
                } else {
                    symbols.append(100)
                    usingCodeC = false
                }
            } else if digitRun >= 4 {
                if digitRun.isMultiple(of: 2) {
                    symbols.append(99)
                    usingCodeC = true
                } else {
                    symbols.append(Int(characters[index].value) - 32)
                    index += 1
                }
            } else {
                symbols.append(Int(characters[index].value) - 32)
                index += 1
            }
        }

        let checksum = symbols.dropFirst().enumerated().reduce(symbols[0]) { result, entry in
            result + entry.element * (entry.offset + 1)
        } % 103
        symbols.append(checksum)
        symbols.append(106)
        return symbols
    }

    private static func digitRunLength(in characters: [UnicodeScalar], from start: Int) -> Int {
        var end = start
        while end < characters.count, (48...57).contains(Int(characters[end].value)) {
            end += 1
        }
        return end - start
    }

    private static let code128Patterns = [
        "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
        "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
        "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
        "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
        "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
        "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
        "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
        "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
        "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
        "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
        "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
        "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
        "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
        "211214", "211232", "2331112"
    ]

    private static func qrMatrix(payload: String) throws -> MonochromeMatrix {
        guard !payload.isEmpty, let filter = CIFilter(name: "CIQRCodeGenerator") else {
            throw ReceiptRasterError.invalidQRCode
        }
        filter.setValue(qrPayloadData(payload), forKey: "inputMessage")
        filter.setValue("L", forKey: "inputCorrectionLevel")
        guard let image = filter.outputImage else {
            throw ReceiptRasterError.invalidQRCode
        }
        return try monochromeMatrix(from: image, invalidError: .invalidQRCode)
    }

    private static func drawQRMatrix(
        _ matrix: MonochromeMatrix,
        in output: inout ESCPosRasterImage,
        canvasX: Int,
        canvasSize: Int,
        scale: Int
    ) {
        let symbolSize = (matrix.width + quietZoneModules * 2) * scale
        let symbolX = canvasX + (canvasSize - symbolSize) / 2 + quietZoneModules * scale
        let symbolY = (canvasSize - symbolSize) / 2 + quietZoneModules * scale

        for y in 0..<matrix.height {
            for x in 0..<matrix.width where matrix.isBlack(x: x, y: y) {
                output.fillBlack(
                    x: symbolX + x * scale,
                    y: symbolY + y * scale,
                    width: scale,
                    height: scale
                )
            }
        }
    }

    private static func monochromeMatrix(
        from image: CIImage,
        invalidError: ReceiptRasterError
    ) throws -> MonochromeMatrix {
        let extent = image.extent.integral
        let width = Int(extent.width)
        let height = Int(extent.height)
        guard width > 0, height > 0 else {
            throw invalidError
        }

        var pixels = Array(repeating: UInt8(255), count: width * height)
        pixels.withUnsafeMutableBytes { buffer in
            guard let baseAddress = buffer.baseAddress else { return }
            context.render(
                image,
                toBitmap: baseAddress,
                rowBytes: width,
                bounds: extent,
                format: .L8,
                colorSpace: CGColorSpaceCreateDeviceGray()
            )
        }
        return MonochromeMatrix(width: width, height: height, pixels: pixels)
    }
}

private struct MonochromeMatrix {
    let width: Int
    let height: Int
    let pixels: [UInt8]

    func isBlack(x: Int, y: Int) -> Bool {
        pixels[y * width + x] < 128
    }

    func hasBlackPixel(inColumn x: Int) -> Bool {
        (0..<height).contains { isBlack(x: x, y: $0) }
    }
}
