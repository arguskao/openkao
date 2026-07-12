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

    func testServerErrorUsesLocalizedBackendMessage() async {
        let session = StubBackendURLSession { request in
            httpResponse(
                statusCode: 409,
                url: request.url,
                body: #"{"error":"device_binding_locked","code":"device_binding_locked","message":"這個帳號已綁定其他手機，請輸入解除綁定碼後再登入。"}"#
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "token", urlSession: session)

        do {
            _ = try await client.fetchAuthMe()
            XCTFail("Expected BackendError.server")
        } catch BackendError.server(let statusCode, let message) {
            XCTAssertEqual(statusCode, 409)
            XCTAssertEqual(message, "這個帳號已綁定其他手機，請輸入解除綁定碼後再登入。")
            XCTAssertEqual(errorDescription(for: BackendError.server(statusCode: statusCode, message: message)), "後台錯誤：這個帳號已綁定其他手機，請輸入解除綁定碼後再登入。")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testServerErrorLocalizesKnownCodeWhenMessageIsMissing() async {
        let session = StubBackendURLSession { request in
            httpResponse(statusCode: 409, url: request.url, body: #"{"error":"device_binding_locked"}"#)
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "token", urlSession: session)

        do {
            _ = try await client.fetchAuthMe()
            XCTFail("Expected BackendError.server")
        } catch BackendError.server(let statusCode, let message) {
            XCTAssertEqual(statusCode, 409)
            XCTAssertEqual(message, "這個帳號已綁定其他手機，請輸入解除綁定碼後再登入。")
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
                      "salesAmount": 45,
                      "taxAmount": 0,
                      "invoiceFormatCode": null,
                      "isReprint": true,
                      "items": [{"id":"item-1","name":"奶茶","quantity":1,"unitPrice":45}],
                      "qrCodePayload": null,
                      "leftQRCodePayload": "AMEGO-LEFT",
                      "rightQRCodePayload": "**AMEGO-RIGHT",
                      "barcodePayload": "11508AB123456781234"
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
        XCTAssertEqual(jobs.first?.leftQRCodePayload, "AMEGO-LEFT")
        XCTAssertEqual(jobs.first?.rightQRCodePayload, "**AMEGO-RIGHT")
        XCTAssertEqual(jobs.first?.barcodePayload, "11508AB123456781234")
        XCTAssertEqual(jobs.first?.salesAmount, 45)
        XCTAssertEqual(jobs.first?.taxAmount, 0)
        XCTAssertNil(jobs.first?.invoiceFormatCode)
        XCTAssertEqual(jobs.first?.isReprint, true)
    }

    func testInvoiceManagementDecodesD1StatusesAndDetails() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.path, "/api/invoices")
            XCTAssertEqual(request.url?.query, "date=2026-07-12")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer auth-token")
            return httpResponse(
                statusCode: 200,
                url: request.url,
                body: """
                {
                  "invoices": [
                    {
                      "id": "issuance-1",
                      "orderId": "ORDER-1",
                      "invoiceNumber": null,
                      "status": "issuing",
                      "issuedAt": "2026-07-12 10:00:00",
                      "totalAmount": 0,
                      "items": []
                    },
                    {
                      "id": "invoice-1",
                      "orderId": "ORDER-2",
                      "invoiceNumber": "AB12345678",
                      "status": "print_failed",
                      "issuedAt": "2026-07-12T10:10:00Z",
                      "randomNumber": "1234",
                      "sellerName": "測試公司",
                      "sellerIdentifier": "12345678",
                      "buyerIdentifier": null,
                      "totalAmount": 45,
                      "voidedAt": null,
                      "items": [{"id":"item-1","name":"奶茶","quantity":1,"unitPrice":45,"amount":45}]
                    }
                  ]
                }
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "auth-token", urlSession: session)
        let date = try XCTUnwrap(DateFormatter.reportQuery.date(from: "2026-07-12"))

        let invoices = try await client.fetchInvoices(date: date)

        XCTAssertEqual(invoices.map(\.status), [.issuing, .printFailed])
        XCTAssertEqual(invoices[0].displayNumber, "ORDER-1")
        XCTAssertEqual(invoices[1].items.first?.name, "奶茶")
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

private func errorDescription(for error: BackendError) -> String? {
    error.errorDescription
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
