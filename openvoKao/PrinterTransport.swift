import Foundation

enum ESCPosPacketizer {
    static func chunks(from data: Data, maximumSize: Int) -> [Data] {
        let maximumSize = max(1, maximumSize)
        let bytes = Array(data)
        var chunks: [Data] = []
        var current = Data()
        var index = 0

        func flush() {
            guard !current.isEmpty else { return }
            chunks.append(current)
            current = Data()
        }

        func appendAtom(_ range: Range<Int>) {
            guard !range.isEmpty else { return }
            let atomSize = range.count
            if atomSize <= maximumSize, current.count + atomSize > maximumSize {
                flush()
            }

            var offset = range.lowerBound
            while offset < range.upperBound {
                if current.count == maximumSize {
                    flush()
                }
                let available = maximumSize - current.count
                let end = min(offset + available, range.upperBound)
                current.append(contentsOf: bytes[offset..<end])
                offset = end
            }
        }

        func appendRasterCommand(headerAt start: Int) -> Int? {
            guard start + 7 < bytes.count else { return nil }
            let widthBytes = Int(bytes[start + 4]) | (Int(bytes[start + 5]) << 8)
            let height = Int(bytes[start + 6]) | (Int(bytes[start + 7]) << 8)
            let payloadSize = widthBytes * height
            let commandEnd = start + 8 + payloadSize
            guard widthBytes > 0, height > 0, commandEnd <= bytes.count else { return nil }

            // Some BLE printer firmware loses raster state when a packet ends
            // immediately after the 8-byte GS v 0 header. Always keep at least
            // one image byte beside the header when the packet size permits it.
            let requiredInitialSize = min(9, maximumSize)
            if maximumSize >= 9, maximumSize - current.count < requiredInitialSize {
                flush()
            }
            appendAtom(start..<(start + requiredInitialSize))
            appendAtom((start + requiredInitialSize)..<commandEnd)
            return commandEnd
        }

        func appendGSParenthesisCommand(headerAt start: Int) -> Int? {
            guard start + 4 < bytes.count else { return nil }
            let bodySize = Int(bytes[start + 3]) | (Int(bytes[start + 4]) << 8)
            let commandEnd = start + 5 + bodySize
            guard commandEnd <= bytes.count else { return nil }

            let requiredInitialSize = min(6, maximumSize)
            if maximumSize >= 6, maximumSize - current.count < requiredInitialSize {
                flush()
            }
            appendAtom(start..<(start + requiredInitialSize))
            appendAtom((start + requiredInitialSize)..<commandEnd)
            return commandEnd
        }

        while index < bytes.count {
            if bytes.matches([0x1D, 0x76, 0x30], at: index),
               let commandEnd = appendRasterCommand(headerAt: index) {
                index = commandEnd
                continue
            }

            if bytes.matches([0x1D, 0x28, 0x6B], at: index),
               let commandEnd = appendGSParenthesisCommand(headerAt: index) {
                index = commandEnd
                continue
            }

            if let commandSize = fixedCommandSize(in: bytes, at: index) {
                appendAtom(index..<(index + commandSize))
                index += commandSize
                continue
            }

            // Receipt text is GB18030/GBK restricted to one- or two-byte
            // characters by ReceiptRenderer. Never leave a lead byte at the
            // end of a BLE packet.
            let characterSize = bytes[index] >= 0x81 && index + 1 < bytes.count ? 2 : 1
            appendAtom(index..<(index + characterSize))
            index += characterSize
        }

        flush()
        return chunks
    }

    private static func fixedCommandSize(in bytes: [UInt8], at index: Int) -> Int? {
        let commands: [([UInt8], Int)] = [
            ([0x1B, 0x40], 2),
            ([0x1C, 0x26], 2),
            ([0x1B, 0x61], 3),
            ([0x1B, 0x45], 3),
            ([0x1D, 0x21], 3),
            ([0x1C, 0x21], 3),
            ([0x1B, 0x21], 3),
            ([0x1B, 0x33], 3),
            ([0x1B, 0x4A], 3),
            ([0x1D, 0x4C], 4)
        ]

        for (prefix, size) in commands where bytes.matches(prefix, at: index) {
            guard index + size <= bytes.count else { return nil }
            return size
        }
        return nil
    }
}

private extension Array where Element == UInt8 {
    func matches(_ prefix: [UInt8], at index: Int) -> Bool {
        guard index >= 0, index + prefix.count <= count else { return false }
        return Array(self[index..<(index + prefix.count)]) == prefix
    }
}

protocol PrinterTransport: AnyObject {
    var maximumChunkSize: Int { get }
    var canSendWriteWithoutResponse: Bool { get }

    func write(_ chunk: Data) throws
    func waitUntilReadyToSend() async throws
}

final class PrinterWritePipeline {
    private let lock = NSLock()
    private var isSending = false

    func send(_ data: Data, transport: PrinterTransport) async throws {
        try beginSend()
        defer { finishSend() }

        let chunkSize = max(1, transport.maximumChunkSize)
        var offset = 0

        while offset < data.count {
            try Task.checkCancellation()

            while !transport.canSendWriteWithoutResponse {
                try await transport.waitUntilReadyToSend()
                try Task.checkCancellation()
            }

            let end = min(offset + chunkSize, data.count)
            try transport.write(data.subdata(in: offset..<end))
            offset = end
        }
    }

    private func beginSend() throws {
        lock.lock()
        defer { lock.unlock() }

        guard !isSending else {
            throw PrinterError.busy
        }

        isSending = true
    }

    private func finishSend() {
        lock.lock()
        isSending = false
        lock.unlock()
    }
}
