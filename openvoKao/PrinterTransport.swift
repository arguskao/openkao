import Foundation

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
