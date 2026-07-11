import Foundation
import XCTest
@testable import openvoKao

final class BackendClientTests: XCTestCase {
    func testBuildsURLAndAuthorizationHeader() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/api/devices/me")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-token")
            return httpResponse(
                statusCode: 200,
                url: request.url,
                body: """
                {"id":"device-1","name":"iPhone","platform":"ios","companyId":7,"companyName":"測試公司","lastSeenAt":null,"isBound":true}
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com/base/", deviceToken: " device-token ", urlSession: session)

        let device = try await client.fetchDevice()

        XCTAssertEqual(device.id, "device-1")
        XCTAssertEqual(device.companyId, 7)
    }

    func testUnauthorizedIsAuthenticationFailure() async {
        let session = StubBackendURLSession { request in
            httpResponse(statusCode: 401, url: request.url, body: #"{"error":"invalid_device_token"}"#)
        }
        let client = BackendClient(serverURL: "https://example.com", deviceToken: "bad", urlSession: session)

        do {
            _ = try await client.fetchDevice()
            XCTFail("Expected BackendError.server")
        } catch let error as BackendError {
            XCTAssertTrue(error.isAuthenticationFailure)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testServerErrorKeepsStatusAndMessage() async {
        let session = StubBackendURLSession { request in
            httpResponse(statusCode: 500, url: request.url, body: #"{"error":"database_down"}"#)
        }
        let client = BackendClient(serverURL: "https://example.com", deviceToken: "token", urlSession: session)

        do {
            _ = try await client.fetchDevice()
            XCTFail("Expected BackendError.server")
        } catch BackendError.server(let statusCode, let message) {
            XCTAssertEqual(statusCode, 500)
            XCTAssertEqual(message, "database_down")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testPendingPrintJobDecodesBackendDates() async throws {
        let session = StubBackendURLSession { request in
            httpResponse(
                statusCode: 200,
                url: request.url,
                body: """
                {
                  "jobs": [{
                    "id": "job-1",
                    "status": "printing",
                    "createdAt": "2026-07-09 13:59:00",
                    "payload": {
                      "remoteId": "job-1",
                      "invoiceNumber": "AB12345678",
                      "randomNumber": "1234",
                      "issuedAt": "2026-07-09T13:59:00Z",
                      "sellerName": "測試商店",
                      "sellerIdentifier": "12345678",
                      "buyerIdentifier": null,
                      "totalAmount": 45,
                      "items": [{"id":"item-1","name":"奶茶","quantity":1,"unitPrice":45}],
                      "qrCodePayload": null,
                      "barcodePayload": "AB12345678"
                    }
                  }]
                }
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com", deviceToken: "token", urlSession: session)

        let jobs = try await client.fetchPendingPrintJobs()

        XCTAssertEqual(jobs.first?.remoteId, "job-1")
        XCTAssertEqual(jobs.first?.issuedAt, ISO8601DateFormatter().date(from: "2026-07-09T13:59:00Z"))
    }

    func testCancellationPropagates() async {
        let session = StubBackendURLSession { _ in
            try await Task.sleep(nanoseconds: 5_000_000_000)
            throw URLError(.badServerResponse)
        }
        let client = BackendClient(serverURL: "https://example.com", deviceToken: "token", urlSession: session)
        let task = Task {
            try await client.fetchDevice()
        }

        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            XCTAssertTrue(true)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTimeoutPropagates() async {
        let session = StubBackendURLSession { _ in
            throw URLError(.timedOut)
        }
        let client = BackendClient(serverURL: "https://example.com", deviceToken: "token", urlSession: session)

        do {
            _ = try await client.fetchDevice()
            XCTFail("Expected timeout")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

private final class StubBackendURLSession: BackendURLSession {
    private let handler: (URLRequest) async throws -> (Data, URLResponse)

    init(handler: @escaping (URLRequest) async throws -> (Data, URLResponse)) {
        self.handler = handler
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await handler(request)
    }
}

private func httpResponse(statusCode: Int, url: URL?, body: String) -> (Data, URLResponse) {
    let response = HTTPURLResponse(
        url: url ?? URL(string: "https://example.com")!,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
    )!
    return (Data(body.utf8), response)
}
