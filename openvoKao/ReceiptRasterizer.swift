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
    // QR scanners require a clear border around the symbol. Four modules is the QR standard.
    private static let quietZoneModules = 4
    private static let officialQRCodeVersion = 6

    static func qrPayloadData(_ payload: String) -> Data {
        Data(payload.utf8)
    }

    static func officialQRModuleWidth(for payload: String) throws -> Int {
        try qrMatrix(payload: payload).width
    }

    static func dualQRCode(
        leftPayload: String,
        rightPayload: String
    ) throws -> ESCPosRasterImage {
        let left = try qrMatrix(payload: leftPayload)
        let right = try qrMatrix(payload: rightPayload)
        let canvasSize = ReceiptLayout.qrCanvasDots
        let gap = ReceiptLayout.qrGapDots

        let pairWidth = canvasSize * 2 + gap
        let pairOriginX = (ReceiptLayout.qrImageWidthDots - pairWidth) / 2
        guard pairOriginX >= 0 else {
            throw ReceiptRasterError.imageTooLarge
        }

        var output = ESCPosRasterImage(width: ReceiptLayout.qrImageWidthDots, height: canvasSize)
        // 左右 QR 的資料長度通常不同，導致 QR 版本（模組數）不同。
        // 若使用相同 scale，較小版本的 QR 會被縮得很小。
        // 因此分別計算 scale，讓兩個 QR 都盡量填滿各自的 canvas，視覺大小才會一致。
        let leftScale = scaleFor(matrix: left, canvasSize: canvasSize)
        let rightScale = scaleFor(matrix: right, canvasSize: canvasSize)
        guard leftScale >= 1, rightScale >= 1 else {
            throw ReceiptRasterError.imageTooLarge
        }
        drawQRMatrix(left, in: &output, canvasX: pairOriginX, canvasSize: canvasSize, scale: leftScale)
        drawQRMatrix(right, in: &output, canvasX: pairOriginX + canvasSize + gap, canvasSize: canvasSize, scale: rightScale)
        return output
    }

    private static func scaleFor(matrix: MonochromeMatrix, canvasSize: Int) -> Int {
        let requiredModules = matrix.width + quietZoneModules * 2
        return canvasSize / requiredModules
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
        guard !payload.isEmpty else {
            throw ReceiptRasterError.invalidQRCode
        }
        return try FixedVersionQRCode.make(
            payload: qrPayloadData(payload),
            version: officialQRCodeVersion,
            correction: .low
        )
    }

    private static func drawQRMatrix(
        _ matrix: MonochromeMatrix,
        in output: inout ESCPosRasterImage,
        canvasX: Int,
        canvasSize: Int,
        scale: Int
    ) {
        let symbolSize = (matrix.width + quietZoneModules * 2) * scale
        // QR 符號（含 quiet zone）應該置中於 canvas 內。
        // 以前多加一次 quietZone*scale 會把圖案推出 canvas 底部/右側，
        // 導致 finder pattern 被截斷而印不出 / 掃不到。
        let symbolX = canvasX + (canvasSize - symbolSize) / 2
        let symbolY = (canvasSize - symbolSize) / 2

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

}

private struct MonochromeMatrix {
    let width: Int
    let height: Int
    let pixels: [UInt8]

    mutating func cropBorder(thickness: Int) {
        guard thickness > 0, width > thickness * 2, height > thickness * 2 else { return }
        let newWidth = width - thickness * 2
        let newHeight = height - thickness * 2
        var newPixels = Array(repeating: UInt8(255), count: newWidth * newHeight)
        for y in 0..<newHeight {
            for x in 0..<newWidth {
                newPixels[y * newWidth + x] = pixels[(y + thickness) * width + (x + thickness)]
            }
        }
        self = MonochromeMatrix(width: newWidth, height: newHeight, pixels: newPixels)
    }

    func isBlack(x: Int, y: Int) -> Bool {
        pixels[y * width + x] < 128
    }

    func hasBlackPixel(inColumn x: Int) -> Bool {
        (0..<height).contains { isBlack(x: x, y: $0) }
    }
}

private enum FixedVersionQRCode {
    enum ErrorCorrection {
        case low

        var formatBits: Int {
            switch self {
            case .low:
                return 0b01
            }
        }
    }

    private static let generatorBase: UInt8 = 0x02
    private static let fieldPolynomial: UInt16 = 0x11D
    private static let maxVersion = 6
    private static let size = 41
    private static let dataCodewords = 136
    private static let eccCodewordsPerBlock = 18
    private static let numberOfBlocks = 2
    private static let dataCodewordsPerBlock = 68
    private static let remainderBits = 7
    private static let alignmentPatternCenters = [6, 34]
    private static let penaltyN1 = 3
    private static let penaltyN2 = 3
    private static let penaltyN3 = 40
    private static let penaltyN4 = 10

    static func make(payload: Data, version: Int, correction: ErrorCorrection) throws -> MonochromeMatrix {
        guard version == maxVersion else {
            throw ReceiptRasterError.invalidQRCode
        }
        let codewords = try encodeCodewords(payload)
        let bits = codewords.flatMap { byteToBits($0) } + Array(repeating: false, count: remainderBits)
        var bestModules: [[Bool]]?
        var bestPenalty = Int.max

        for mask in 0..<8 {
            var qr = QRCanvas(size: size)
            qr.drawFunctionPatterns()
            qr.drawCodewords(bits)
            qr.applyMask(mask)
            qr.drawFormatBits(mask: mask, correction: correction)
            let penalty = qr.penaltyScore()
            if penalty < bestPenalty {
                bestPenalty = penalty
                bestModules = qr.modules
            }
        }

        guard let modules = bestModules else {
            throw ReceiptRasterError.invalidQRCode
        }
        return MonochromeMatrix(
            width: size,
            height: size,
            pixels: modules.flatMap { row in row.map { $0 ? UInt8(0) : UInt8(255) } }
        )
    }

    private static func encodeCodewords(_ payload: Data) throws -> [UInt8] {
        let capacityBits = dataCodewords * 8
        var bits: [Bool] = []
        appendBits(0b0100, count: 4, to: &bits)
        appendBits(payload.count, count: 8, to: &bits)
        for byte in payload {
            appendBits(Int(byte), count: 8, to: &bits)
        }
        guard bits.count <= capacityBits else {
            throw ReceiptRasterError.invalidQRCode
        }
        appendBits(0, count: min(4, capacityBits - bits.count), to: &bits)
        while !bits.count.isMultiple(of: 8) {
            bits.append(false)
        }

        var data = bitsToBytes(bits)
        var useFirstPad = true
        while data.count < dataCodewords {
            data.append(useFirstPad ? 0xEC : 0x11)
            useFirstPad.toggle()
        }

        let blocks = stride(from: 0, to: data.count, by: dataCodewordsPerBlock).map {
            Array(data[$0..<($0 + dataCodewordsPerBlock)])
        }
        guard blocks.count == numberOfBlocks else {
            throw ReceiptRasterError.invalidQRCode
        }

        let generator = makeReedSolomonGenerator(degree: eccCodewordsPerBlock)
        let eccBlocks = blocks.map { makeReedSolomonRemainder(data: $0, generator: generator) }

        var interleaved: [UInt8] = []
        for index in 0..<dataCodewordsPerBlock {
            for block in blocks {
                interleaved.append(block[index])
            }
        }
        for index in 0..<eccCodewordsPerBlock {
            for block in eccBlocks {
                interleaved.append(block[index])
            }
        }
        return interleaved
    }

    private static func appendBits(_ value: Int, count: Int, to bits: inout [Bool]) {
        guard count > 0 else { return }
        for shift in stride(from: count - 1, through: 0, by: -1) {
            bits.append(((value >> shift) & 1) != 0)
        }
    }

    private static func bitsToBytes(_ bits: [Bool]) -> [UInt8] {
        stride(from: 0, to: bits.count, by: 8).map { offset in
            var value = 0
            for bitIndex in 0..<8 where offset + bitIndex < bits.count {
                value = (value << 1) | (bits[offset + bitIndex] ? 1 : 0)
            }
            return UInt8(value)
        }
    }

    private static func byteToBits(_ byte: UInt8) -> [Bool] {
        (0..<8).map { shift in
            ((byte >> (7 - shift)) & 1) != 0
        }
    }

    private static func makeReedSolomonGenerator(degree: Int) -> [UInt8] {
        var generator = [UInt8](repeating: 0, count: degree)
        generator[degree - 1] = 1
        var root: UInt8 = 1
        for _ in 0..<degree {
            for index in 0..<degree {
                generator[index] = multiply(generator[index], root)
                if index + 1 < degree {
                    generator[index] ^= generator[index + 1]
                }
            }
            root = multiply(root, generatorBase)
        }
        return generator
    }

    private static func makeReedSolomonRemainder(data: [UInt8], generator: [UInt8]) -> [UInt8] {
        var remainder = [UInt8](repeating: 0, count: generator.count)
        for byte in data {
            let factor = byte ^ remainder.removeFirst()
            remainder.append(0)
            guard factor != 0 else { continue }
            for index in 0..<generator.count {
                remainder[index] ^= multiply(generator[index], factor)
            }
        }
        return remainder
    }

    private static func multiply(_ x: UInt8, _ y: UInt8) -> UInt8 {
        var a = UInt16(x)
        var b = UInt16(y)
        var result: UInt16 = 0
        while b != 0 {
            if (b & 1) != 0 {
                result ^= a
            }
            b >>= 1
            a <<= 1
            if (a & 0x100) != 0 {
                a ^= fieldPolynomial
            }
        }
        return UInt8(result & 0xFF)
    }

    private struct QRCanvas {
        let size: Int
        var modules: [[Bool]]
        var functionModules: [[Bool]]

        init(size: Int) {
            self.size = size
            self.modules = Array(
                repeating: Array(repeating: false, count: size),
                count: size
            )
            self.functionModules = Array(
                repeating: Array(repeating: false, count: size),
                count: size
            )
        }

        mutating func drawFunctionPatterns() {
            drawFinderPattern(x: 3, y: 3)
            drawFinderPattern(x: size - 4, y: 3)
            drawFinderPattern(x: 3, y: size - 4)
            reserveFormatInformation()

            for centerY in alignmentPatternCenters {
                for centerX in alignmentPatternCenters {
                    let overlapsTop = centerY == 6 && (centerX == 6 || centerX == size - 7)
                    let overlapsLeftBottom = centerX == 6 && centerY == size - 7
                    if overlapsTop || overlapsLeftBottom {
                        continue
                    }
                    drawAlignmentPattern(x: centerX, y: centerY)
                }
            }

            for index in 8..<(size - 8) {
                setFunctionModule(x: index, y: 6, isBlack: index.isMultiple(of: 2))
                setFunctionModule(x: 6, y: index, isBlack: index.isMultiple(of: 2))
            }
            setFunctionModule(x: 8, y: size - 8, isBlack: true)
        }

        mutating func drawCodewords(_ bits: [Bool]) {
            var bitIndex = 0
            var upward = true
            var column = size - 1

            while column > 0 {
                if column == 6 {
                    column -= 1
                }
                for rowIndex in 0..<size {
                    let row = upward ? (size - 1 - rowIndex) : rowIndex
                    for columnOffset in 0..<2 {
                        let x = column - columnOffset
                        guard !functionModules[row][x], bitIndex < bits.count else {
                            continue
                        }
                        modules[row][x] = bits[bitIndex]
                        bitIndex += 1
                    }
                }
                upward.toggle()
                column -= 2
            }
        }

        mutating func applyMask(_ mask: Int) {
            for y in 0..<size {
                for x in 0..<size where !functionModules[y][x] {
                    if maskApplies(mask, x: x, y: y) {
                        modules[y][x].toggle()
                    }
                }
            }
        }

        mutating func drawFormatBits(mask: Int, correction: ErrorCorrection) {
            let data = (correction.formatBits << 3) | mask
            var rem = data
            for _ in 0..<10 {
                rem <<= 1
            }
            for shift in stride(from: 14, through: 10, by: -1) {
                if ((rem >> shift) & 1) != 0 {
                    rem ^= 0x537 << (shift - 10)
                }
            }
            let bits = ((data << 10) | rem) ^ 0x5412

            for index in 0...5 {
                setFunctionModule(x: 8, y: index, isBlack: ((bits >> index) & 1) != 0)
            }
            setFunctionModule(x: 8, y: 7, isBlack: ((bits >> 6) & 1) != 0)
            setFunctionModule(x: 8, y: 8, isBlack: ((bits >> 7) & 1) != 0)
            setFunctionModule(x: 7, y: 8, isBlack: ((bits >> 8) & 1) != 0)
            for index in 9...14 {
                setFunctionModule(x: 14 - index, y: 8, isBlack: ((bits >> index) & 1) != 0)
            }

            for index in 0...7 {
                setFunctionModule(x: size - 1 - index, y: 8, isBlack: ((bits >> index) & 1) != 0)
            }
            for index in 8...14 {
                setFunctionModule(x: 8, y: size - 15 + index, isBlack: ((bits >> index) & 1) != 0)
            }
            setFunctionModule(x: 8, y: size - 8, isBlack: true)
        }

        func penaltyScore() -> Int {
            penaltyRuns() + penaltyBlocks() + penaltyFinderLikePatterns() + penaltyDarkBalance()
        }

        private mutating func reserveFormatInformation() {
            for index in 0..<9 {
                if index != 6 {
                    functionModules[index][8] = true
                    functionModules[8][index] = true
                }
            }
            for index in 0..<8 {
                functionModules[size - 1 - index][8] = true
                functionModules[8][size - 1 - index] = true
            }
            functionModules[size - 8][8] = true
        }

        private mutating func drawFinderPattern(x: Int, y: Int) {
            for deltaY in -4...4 {
                for deltaX in -4...4 {
                    let xx = x + deltaX
                    let yy = y + deltaY
                    guard (0..<size).contains(xx), (0..<size).contains(yy) else {
                        continue
                    }
                    let distance = max(abs(deltaX), abs(deltaY))
                    let isBlack = distance != 2 && distance != 4
                    setFunctionModule(x: xx, y: yy, isBlack: isBlack)
                }
            }
        }

        private mutating func drawAlignmentPattern(x: Int, y: Int) {
            for deltaY in -2...2 {
                for deltaX in -2...2 {
                    let distance = max(abs(deltaX), abs(deltaY))
                    setFunctionModule(x: x + deltaX, y: y + deltaY, isBlack: distance != 1)
                }
            }
        }

        private mutating func setFunctionModule(x: Int, y: Int, isBlack: Bool) {
            guard (0..<size).contains(x), (0..<size).contains(y) else { return }
            modules[y][x] = isBlack
            functionModules[y][x] = true
        }

        private func maskApplies(_ mask: Int, x: Int, y: Int) -> Bool {
            switch mask {
            case 0:
                return (x + y).isMultiple(of: 2)
            case 1:
                return y.isMultiple(of: 2)
            case 2:
                return x.isMultiple(of: 3)
            case 3:
                return (x + y).isMultiple(of: 3)
            case 4:
                return ((y / 2) + (x / 3)).isMultiple(of: 2)
            case 5:
                let value = (x * y) % 2 + (x * y) % 3
                return value == 0
            case 6:
                let value = ((x * y) % 2 + (x * y) % 3) % 2
                return value == 0
            case 7:
                let value = ((x + y) % 2 + (x * y) % 3) % 2
                return value == 0
            default:
                return false
            }
        }

        private func penaltyRuns() -> Int {
            var score = 0
            for row in modules {
                score += penaltyRunSequence(row)
            }
            for x in 0..<size {
                let column = (0..<size).map { modules[$0][x] }
                score += penaltyRunSequence(column)
            }
            return score
        }

        private func penaltyRunSequence(_ values: [Bool]) -> Int {
            guard var current = values.first else { return 0 }
            var runLength = 1
            var score = 0

            for value in values.dropFirst() {
                if value == current {
                    runLength += 1
                    continue
                }
                if runLength >= 5 {
                    score += penaltyN1 + (runLength - 5)
                }
                current = value
                runLength = 1
            }
            if runLength >= 5 {
                score += penaltyN1 + (runLength - 5)
            }
            return score
        }

        private func penaltyBlocks() -> Int {
            var score = 0
            for y in 0..<(size - 1) {
                for x in 0..<(size - 1) {
                    let value = modules[y][x]
                    if modules[y][x + 1] == value,
                       modules[y + 1][x] == value,
                       modules[y + 1][x + 1] == value {
                        score += penaltyN2
                    }
                }
            }
            return score
        }

        private func penaltyFinderLikePatterns() -> Int {
            let pattern1 = [true, false, true, true, true, false, true, false, false, false, false]
            let pattern2 = [false, false, false, false, true, false, true, true, true, false, true]
            var score = 0

            for row in modules {
                score += penaltyPatternSequence(row, pattern1, pattern2)
            }
            for x in 0..<size {
                let column = (0..<size).map { modules[$0][x] }
                score += penaltyPatternSequence(column, pattern1, pattern2)
            }
            return score
        }

        private func penaltyPatternSequence(_ values: [Bool], _ pattern1: [Bool], _ pattern2: [Bool]) -> Int {
            guard values.count >= pattern1.count else { return 0 }
            var score = 0
            for start in 0...(values.count - pattern1.count) {
                let slice = Array(values[start..<(start + pattern1.count)])
                if slice == pattern1 || slice == pattern2 {
                    score += penaltyN3
                }
            }
            return score
        }

        private func penaltyDarkBalance() -> Int {
            let dark = modules.reduce(0) { partial, row in
                partial + row.reduce(0) { $0 + ($1 ? 1 : 0) }
            }
            let total = size * size
            let percent = (Double(dark) * 100.0) / Double(total)
            return Int(abs(percent - 50.0) / 5.0) * penaltyN4
        }
    }
}
