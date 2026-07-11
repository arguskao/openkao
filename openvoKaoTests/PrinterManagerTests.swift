import Foundation
import XCTest
@testable import openvoKao

final class PrinterManagerTests: XCTestCase {
    func testChunksDataByTransportLimit() async throws {
        let transport = FakePrinterTransport(maximumChunkSize: 3)
        try await PrinterWritePipeline().send(Data([1, 2, 3, 4, 5, 6, 7]), transport: transport)

        XCTAssertEqual(transport.writes, [
            Data([1, 2, 3]),
            Data([4, 5, 6]),
            Data([7])
        ])
    }

    func testBackpressureWaitsForReadySignal() async throws {
        let transport = FakePrinterTransport(maximumChunkSize: 2, ready: false, readyAfterWait: true)

        try await PrinterWritePipeline().send(Data([1, 2, 3]), transport: transport)

        XCTAssertEqual(transport.waitCount, 1)
        XCTAssertEqual(transport.writes, [Data([1, 2]), Data([3])])
    }

    func testDisconnectErrorStopsTransmission() async {
        let transport = FakePrinterTransport(maximumChunkSize: 2)
        transport.writeError = PrinterError.connectionLost

        do {
            try await PrinterWritePipeline().send(Data([1, 2, 3]), transport: transport)
            XCTFail("Expected connectionLost")
        } catch PrinterError.connectionLost {
            XCTAssertEqual(transport.writes, [])
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testCancellationStopsWhileWaitingForBackpressure() async {
        let transport = FakePrinterTransport(maximumChunkSize: 2, ready: false)
        transport.waitDelayNanoseconds = 5_000_000_000
        let pipeline = PrinterWritePipeline()

        let task = Task {
            try await pipeline.send(Data([1, 2, 3]), transport: transport)
        }
        task.cancel()

        do {
            try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            XCTAssertTrue(transport.writes.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testConcurrentPrintsAreRejected() async {
        let transport = FakePrinterTransport(maximumChunkSize: 2, ready: false)
        transport.waitDelayNanoseconds = 200_000_000
        let pipeline = PrinterWritePipeline()

        let first = Task {
            try await pipeline.send(Data([1, 2, 3]), transport: transport)
        }

        try? await Task.sleep(nanoseconds: 20_000_000)

        do {
            try await pipeline.send(Data([4, 5]), transport: transport)
            XCTFail("Expected busy error")
        } catch PrinterError.busy {
            first.cancel()
        } catch {
            XCTFail("Unexpected error: \(error)")
            first.cancel()
        }

        _ = try? await first.value
    }
}

private final class FakePrinterTransport: PrinterTransport {
    let maximumChunkSize: Int
    var canSendWriteWithoutResponse: Bool { ready }
    var writes: [Data] = []
    var waitCount = 0
    var writeError: Error?
    var waitDelayNanoseconds: UInt64 = 0

    private var ready: Bool
    private let readyAfterWait: Bool

    init(maximumChunkSize: Int, ready: Bool = true, readyAfterWait: Bool = false) {
        self.maximumChunkSize = maximumChunkSize
        self.ready = ready
        self.readyAfterWait = readyAfterWait
    }

    func write(_ chunk: Data) throws {
        if let writeError {
            throw writeError
        }
        writes.append(chunk)
    }

    func waitUntilReadyToSend() async throws {
        waitCount += 1
        if waitDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: waitDelayNanoseconds)
        }
        if readyAfterWait {
            ready = true
        }
    }
}
