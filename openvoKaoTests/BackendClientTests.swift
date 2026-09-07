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

    func testDeviceLimitErrorIncludesCurrentUsage() async {
        let session = StubBackendURLSession { request in
            httpResponse(
                statusCode: 409,
                url: request.url,
                body: #"{"error":"device_limit_reached","code":"device_limit_reached","deviceLimit":3,"deviceUsed":3}"#
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "token", urlSession: session)

        do {
            _ = try await client.fetchAuthMe()
            XCTFail("Expected BackendError.server")
        } catch BackendError.server(let statusCode, let message) {
            XCTAssertEqual(statusCode, 409)
            XCTAssertEqual(message, "此公司已綁定 3 / 3 支手機，請聯絡 OpenvoKao 調整配額或先解除舊手機。")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testAuthMeDecodesCompanyDeviceQuota() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.path, "/api/auth/me")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer auth-token")
            return httpResponse(
                statusCode: 200,
                url: request.url,
                body: """
                {
                  "authToken": "auth-token",
                  "user": {
                    "id": 1,
                    "name": "老闆",
                    "account": "owner",
                    "phone": "0900000000",
                    "role": "owner"
                  },
                  "company": {
                    "id": 7,
                    "name": "測試公司",
                    "taxId": "12345678",
                    "address": "台北市",
                    "hasAppKeyConfigured": true,
                    "deviceLimit": 3,
                    "deviceUsed": 2
                  },
                  "device": {"id": "device-1", "token": "device-token", "name": "櫃台 iPhone"}
                }
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "auth-token", urlSession: session)

        let response = try await client.fetchAuthMe()

        XCTAssertEqual(response.company.deviceLimit, 3)
        XCTAssertEqual(response.company.deviceUsed, 2)
        XCTAssertEqual(response.user.role, "owner")
    }

    func testFetchStaffMembersUsesOwnerAuthAndDecodesStatus() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.path, "/api/members")
            XCTAssertEqual(request.url?.query, "includeInactive=true")
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer owner-token")
            return httpResponse(
                statusCode: 200,
                url: request.url,
                body: """
                {
                  "members": [{
                    "id": 12,
                    "account": "staffone",
                    "name": "員工一",
                    "phone": "0911222333",
                    "role": "staff",
                    "isActive": false,
                    "createdAt": "2026-07-14 09:00:00",
                    "updatedAt": "2026-07-14 10:00:00"
                  }]
                }
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "owner-token", urlSession: session)

        let members = try await client.fetchStaffMembers()

        XCTAssertEqual(members.count, 1)
        XCTAssertEqual(members[0].account, "staffone")
        XCTAssertFalse(members[0].isActive)
    }

    func testManagedDevicesDecodeQuotaAndUnbindSendsCode() async throws {
        var requestCount = 0
        let session = StubBackendURLSession { request in
            requestCount += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer owner-token")

            if requestCount == 1 {
                XCTAssertEqual(request.url?.path, "/api/devices")
                XCTAssertEqual(request.httpMethod, "GET")
                return httpResponse(
                    statusCode: 200,
                    url: request.url,
                    body: """
                    {
                      "devices": [{
                        "id": "device-1",
                        "companyId": 7,
                        "name": "櫃台 iPhone",
                        "platform": "ios",
                        "installationId": "installation-1",
                        "lastSeenAt": "2026-07-14 10:00:00",
                        "createdAt": "2026-07-14 09:00:00",
                        "updatedAt": "2026-07-14 10:00:00"
                      }],
                      "deviceLimit": 2,
                      "deviceUsed": 1
                    }
                    """
                )
            }

            XCTAssertEqual(request.url?.path, "/api/devices/device-1")
            XCTAssertEqual(request.httpMethod, "DELETE")
            let body = try XCTUnwrap(request.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["unbindCode"], "12345678")
            return httpResponse(statusCode: 200, url: request.url, body: "{}")
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "owner-token", urlSession: session)

        let response = try await client.fetchManagedDevices()
        try await client.revokeManagedDevice(id: "device-1", unbindCode: "12345678")

        XCTAssertEqual(response.deviceLimit, 2)
        XCTAssertEqual(response.deviceUsed, 1)
        XCTAssertEqual(response.devices.first?.installationId, "installation-1")
        XCTAssertEqual(requestCount, 2)
    }

    func testDeleteAccountUsesAuthenticatedDeleteAndPassword() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.path, "/api/account")
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer auth-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            let body = try XCTUnwrap(request.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
            XCTAssertEqual(json["password"], "secret123")
            return httpResponse(statusCode: 200, url: request.url, body: #"{"ok":true}"#)
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "auth-token", urlSession: session)

        try await client.deleteAccount(password: "secret123")
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

    func testIssueInvoicePostsAuthPayload() async throws {
        let session = StubBackendURLSession { request in
            XCTAssertEqual(request.url?.path, "/api/invoices")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer auth-token")
            let body = try XCTUnwrap(request.httpBody)
            let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]
            XCTAssertEqual(json?["orderId"] as? String, "APP-20260712153000-ABCDEF12")
            XCTAssertEqual(json?["buyerIdentifier"] as? String, "03741302")
            XCTAssertEqual(json?["totalAmount"] as? Int, 135)
            XCTAssertEqual(json?["print"] as? Bool, true)
            let items = try XCTUnwrap(json?["items"] as? [[String: Any]])
            XCTAssertEqual(items.count, 2)
            XCTAssertEqual(items[0]["name"] as? String, "加蛋")
            XCTAssertEqual(items[0]["quantity"] as? Int, 3)
            XCTAssertEqual(items[0]["unitPrice"] as? Int, 15)
            XCTAssertEqual(items[1]["name"] as? String, "奶茶")

            return httpResponse(
                statusCode: 201,
                url: request.url,
                body: """
                {
                  "issuanceId": "issue-1",
                  "status": "issued",
                  "orderId": "APP-20260712153000-ABCDEF12",
                  "invoiceId": "invoice-1",
                  "invoiceNumber": "AB12345678",
                  "randomNumber": "1234",
                  "printJobId": "job-1"
                }
                """
            )
        }
        let client = BackendClient(serverURL: "https://example.com", authToken: "auth-token", urlSession: session)

        let invoice = try await client.issueInvoice(
            orderId: "APP-20260712153000-ABCDEF12",
            buyerIdentifier: "03741302",
            totalAmount: 135,
            items: [
                InvoiceIssueItemRequest(name: "加蛋", quantity: 3, unitPrice: 15),
                InvoiceIssueItemRequest(name: "奶茶", quantity: 2, unitPrice: 45)
            ],
            shouldPrint: true
        )

        XCTAssertEqual(invoice.invoiceNumber, "AB12345678")
        XCTAssertEqual(invoice.printJobId, "job-1")
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
