import Foundation

struct BackendClient {
    let serverURL: String
    let deviceToken: String?
    let authToken: String?
    let urlSession: BackendURLSession

    init(
        serverURL: String,
        deviceToken: String? = nil,
        authToken: String? = nil,
        urlSession: BackendURLSession = URLSession.shared
    ) {
        self.serverURL = serverURL
        self.deviceToken = deviceToken
        self.authToken = authToken
        self.urlSession = urlSession
    }

    func registerAccount(
        name: String,
        phone: String,
        account: String,
        password: String,
        companyName: String,
        taxId: String,
        address: String,
        deviceName: String,
        installationId: String,
        platform: String = "ios"
    ) async throws -> AuthResponse {
        try await request(
            path: "/api/auth/register",
            method: "POST",
            authorization: .none,
            body: AuthRegisterRequest(
                name: name,
                phone: phone,
                account: account,
                password: password,
                companyName: companyName,
                taxId: taxId,
                address: address,
                deviceName: deviceName,
                installationId: installationId,
                platform: platform
            )
        )
    }

    func loginAccount(
        account: String,
        password: String,
        deviceName: String,
        installationId: String,
        unbindCode: String? = nil,
        platform: String = "ios"
    ) async throws -> AuthResponse {
        try await request(
            path: "/api/auth/login",
            method: "POST",
            authorization: .none,
            body: AuthLoginRequest(
                account: account,
                password: password,
                deviceName: deviceName,
                installationId: installationId,
                unbindCode: unbindCode,
                platform: platform
            )
        )
    }

    func fetchAuthMe() async throws -> AuthResponse {
        try await request(
            path: "/api/auth/me",
            method: "GET",
            authorization: .auth
        )
    }

    func logoutAccount() async throws {
        let _: EmptyResponse = try await request(
            path: "/api/auth/logout",
            method: "POST",
            authorization: .auth,
            body: EmptyRequest()
        )
    }

    func fetchStaffMembers() async throws -> [StaffMember] {
        let response: StaffMembersResponse = try await request(
            path: "/api/members?includeInactive=true",
            method: "GET",
            authorization: .auth
        )
        return response.members
    }

    func createStaffMember(account: String, password: String, name: String, phone: String) async throws -> StaffMember {
        let response: StaffMemberResponse = try await request(
            path: "/api/members",
            method: "POST",
            authorization: .auth,
            body: StaffCreateRequest(account: account, password: password, name: name, phone: phone)
        )
        return response.member
    }

    func updateStaffMember(id: Int, name: String, phone: String, isActive: Bool) async throws -> StaffMember {
        let response: StaffMemberResponse = try await request(
            path: "/api/members/\(id)",
            method: "PUT",
            authorization: .auth,
            body: StaffUpdateRequest(name: name, phone: phone, isActive: isActive)
        )
        return response.member
    }

    func deleteStaffMember(id: Int) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/members/\(id)",
            method: "DELETE",
            authorization: .auth
        )
    }

    func resetStaffPassword(id: Int, password: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/members/\(id)/reset-password",
            method: "POST",
            authorization: .auth,
            body: PasswordResetRequest(password: password)
        )
    }

    func fetchManagedDevices() async throws -> ManagedCompanyDevices {
        try await request(
            path: "/api/devices",
            method: "GET",
            authorization: .auth
        )
    }

    func revokeManagedDevice(id: String, unbindCode: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/devices/\(id)",
            method: "DELETE",
            authorization: .auth,
            body: DeviceUnbindRequest(unbindCode: unbindCode)
        )
    }

    func fetchDevice() async throws -> BackendDevice {
        try await request(
            path: "/api/devices/me",
            method: "GET",
            authorization: .device
        )
    }

    func fetchPendingPrintJobs() async throws -> [PrintJob] {
        let response: PendingPrintJobsResponse = try await request(
            path: "/api/print-jobs/pending",
            method: "GET",
            authorization: .device
        )

        return response.jobs.map { $0.printJob() }
    }

    func reportPrinted(remoteId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/print-jobs/\(remoteId)/printed",
            method: "POST",
            authorization: .device,
            body: EmptyRequest()
        )
    }

    func reportFailed(remoteId: String, message: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/print-jobs/\(remoteId)/failed",
            method: "POST",
            authorization: .device,
            body: FailedRequest(message: message)
        )
    }

    func fetchCatalogCategories() async throws -> [CatalogCategory] {
        let response: CatalogCategoriesResponse = try await request(
            path: "/api/catalog/categories",
            method: "GET",
            authorization: .auth
        )
        return response.categories
    }

    func createCatalogCategory(name: String, sortOrder: Int, status: String) async throws -> CatalogCategory {
        let response: CatalogCategoryResponse = try await request(
            path: "/api/catalog/categories",
            method: "POST",
            authorization: .auth,
            body: CatalogCategoryUpsertRequest(name: name, sortOrder: sortOrder, status: status)
        )
        return response.category
    }

    func updateCatalogCategory(id: Int, name: String, sortOrder: Int, status: String) async throws -> CatalogCategory {
        let response: CatalogCategoryResponse = try await request(
            path: "/api/catalog/categories/\(id)",
            method: "PUT",
            authorization: .auth,
            body: CatalogCategoryUpsertRequest(name: name, sortOrder: sortOrder, status: status)
        )
        return response.category
    }

    func deleteCatalogCategory(id: Int) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/catalog/categories/\(id)",
            method: "DELETE",
            authorization: .auth
        )
    }

    func fetchCatalogProducts() async throws -> CatalogProductsResponse {
        try await request(
            path: "/api/catalog/products",
            method: "GET",
            authorization: .auth
        )
    }

    func createCatalogProduct(
        categoryId: Int?,
        name: String,
        price: Int,
        imagePath: String?,
        status: String,
        taxType: String,
        sortOrder: Int
    ) async throws -> CatalogProduct {
        let response: CatalogProductResponse = try await request(
            path: "/api/catalog/products",
            method: "POST",
            authorization: .auth,
            body: CatalogProductUpsertRequest(
                categoryId: categoryId,
                name: name,
                price: price,
                imagePath: imagePath,
                status: status,
                taxType: taxType,
                sortOrder: sortOrder
            )
        )
        return response.product
    }

    func updateCatalogProduct(
        id: Int,
        categoryId: Int?,
        name: String,
        price: Int,
        imagePath: String?,
        status: String,
        taxType: String,
        sortOrder: Int
    ) async throws -> CatalogProduct {
        let response: CatalogProductResponse = try await request(
            path: "/api/catalog/products/\(id)",
            method: "PUT",
            authorization: .auth,
            body: CatalogProductUpsertRequest(
                categoryId: categoryId,
                name: name,
                price: price,
                imagePath: imagePath,
                status: status,
                taxType: taxType,
                sortOrder: sortOrder
            )
        )
        return response.product
    }

    func updateCatalogPriceSettings(priceDecimalPlaces: Int) async throws -> Int {
        let response: CatalogSettingsResponse = try await request(
            path: "/api/catalog/settings",
            method: "PUT",
            authorization: .auth,
            body: CatalogSettingsUpdateRequest(priceDecimalPlaces: priceDecimalPlaces)
        )
        return response.priceDecimalPlaces
    }

    func deleteCatalogProduct(id: Int) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/catalog/products/\(id)",
            method: "DELETE",
            authorization: .auth
        )
    }

    func fetchSalesReport(startDate: Date, endDate: Date, cursor: String? = nil) async throws -> SalesReportPayload {
        let formatter = DateFormatter.reportQuery
        var path = "/api/reports/sales?startDate=\(formatter.string(from: startDate))&endDate=\(formatter.string(from: endDate))"
        if let cursor, !cursor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor
            path += "&cursor=\(encoded)"
        }
        let response: SalesReportPayload = try await request(
            path: path,
            method: "GET",
            authorization: .auth
        )
        return response
    }

    func fetchInvoices(date: Date) async throws -> [ManagedInvoice] {
        let value = DateFormatter.reportQuery.string(from: date)
        let response: ManagedInvoicesResponse = try await request(
            path: "/api/invoices?date=\(value)",
            method: "GET",
            authorization: .auth
        )
        return response.invoices
    }

    func issueInvoice(
        orderId: String,
        buyerIdentifier: String?,
        totalAmount: Int,
        items: [InvoiceIssueItemRequest],
        shouldPrint: Bool
    ) async throws -> IssuedInvoice {
        try await request(
            path: "/api/invoices",
            method: "POST",
            authorization: .auth,
            body: InvoiceIssueRequest(
                orderId: orderId,
                buyerIdentifier: buyerIdentifier,
                totalAmount: totalAmount,
                items: items,
                print: shouldPrint
            )
        )
    }

    func refreshInvoice(id: String) async throws -> ManagedInvoice {
        let response: ManagedInvoiceResponse = try await request(
            path: "/api/invoices/\(id)/refresh",
            method: "POST",
            authorization: .auth,
            body: EmptyRequest()
        )
        return response.invoice
    }

    func requestInvoiceReprint(id: String) async throws -> String {
        let response: InvoiceReprintResponse = try await request(
            path: "/api/invoices/\(id)/reprint",
            method: "POST",
            authorization: .auth,
            body: EmptyRequest()
        )
        return response.printJobId
    }

    func voidInvoice(id: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/invoices/\(id)/void",
            method: "POST",
            authorization: .auth,
            body: EmptyRequest()
        )
    }

    private func request<ResponseBody: Decodable>(
        path: String,
        method: String,
        authorization: AuthorizationMode
    ) async throws -> ResponseBody {
        try await request(path: path, method: method, authorization: authorization, body: Optional<EmptyRequest>.none)
    }

    private func request<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        method: String,
        authorization: AuthorizationMode,
        body: RequestBody?
    ) async throws -> ResponseBody {
        guard !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BackendError.missingServerURL
        }

        guard let baseURL = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidServerURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        switch authorization {
        case .none:
            break
        case .device:
            guard let deviceToken, !deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw BackendError.missingDeviceToken
            }
            request.setValue("Bearer \(deviceToken.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        case .auth:
            guard let authToken, !authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw BackendError.missingAuthToken
            }
            request.setValue("Bearer \(authToken.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.backend.encode(body)
        }

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let error = try? JSONDecoder.backend.decode(ErrorResponse.self, from: data)
            throw BackendError.server(
                statusCode: httpResponse.statusCode,
                message: error?.displayMessage ?? "HTTP \(httpResponse.statusCode)"
            )
        }

        return try JSONDecoder.backend.decode(ResponseBody.self, from: data)
    }
}

protocol BackendURLSession {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: BackendURLSession {}

struct BackendDevice: Decodable {
    let id: String
    let name: String
    let platform: String
    let companyId: Int
    let companyName: String?
    let lastSeenAt: String?
    let isBound: Bool
}

enum BackendError: LocalizedError {
    case missingServerURL
    case missingDeviceToken
    case missingAuthToken
    case invalidServerURL
    case invalidResponse
    case server(statusCode: Int, message: String)

    var isAuthenticationFailure: Bool {
        switch self {
        case .missingAuthToken:
            return true
        case .server(let statusCode, _):
            return statusCode == 401 || statusCode == 403
        default:
            return false
        }
    }

    var errorDescription: String? {
        switch self {
        case .missingServerURL:
            return "請先設定伺服器 URL"
        case .missingDeviceToken:
            return "請先設定裝置 token"
        case .missingAuthToken:
            return "請先登入帳號"
        case .invalidServerURL:
            return "伺服器 URL 格式錯誤"
        case .invalidResponse:
            return "後台回應格式錯誤"
        case .server(_, let message):
            return "後台錯誤：\(message)"
        }
    }
}

private struct PendingPrintJobsResponse: Decodable {
    let jobs: [RemotePrintJob]
}

private struct RemotePrintJob: Decodable {
    let id: String
    let status: String
    let createdAt: String
    let payload: RemotePrintJobPayload

    func printJob() -> PrintJob {
        payload.printJob(remoteId: id, status: status)
    }
}

private struct RemotePrintJobPayload: Decodable {
    let remoteId: String?
    let invoiceNumber: String
    let randomNumber: String
    let issuedAt: Date
    let sellerName: String?
    let sellerIdentifier: String?
    let buyerIdentifier: String?
    let totalAmount: Int
    let salesAmount: Int?
    let taxAmount: Int?
    let invoiceFormatCode: String?
    let isReprint: Bool?
    let items: [RemotePrintJobItem]
    let qrCodePayload: String?
    let leftQRCodePayload: String?
    let rightQRCodePayload: String?
    let barcodePayload: String?

    func printJob(remoteId: String, status: String) -> PrintJob {
        PrintJob(
            id: UUID(),
            remoteId: remoteId,
            invoiceNumber: invoiceNumber,
            randomNumber: randomNumber,
            issuedAt: issuedAt,
            sellerName: sellerName,
            sellerIdentifier: sellerIdentifier,
            buyerIdentifier: buyerIdentifier,
            totalAmount: totalAmount,
            salesAmount: salesAmount,
            taxAmount: taxAmount,
            invoiceFormatCode: invoiceFormatCode,
            isReprint: isReprint,
            items: items.map { $0.printJobItem() },
            qrCodePayload: qrCodePayload,
            leftQRCodePayload: leftQRCodePayload,
            rightQRCodePayload: rightQRCodePayload,
            barcodePayload: barcodePayload,
            status: status == "printing" ? .printing : .pending,
            lastMessage: nil
        )
    }
}

private struct RemotePrintJobItem: Decodable {
    let id: String?
    let name: String
    let quantity: Int
    let unitPrice: Int

    func printJobItem() -> PrintJobItem {
        PrintJobItem(
            id: UUID(),
            name: name,
            quantity: quantity,
            unitPrice: unitPrice
        )
    }
}

private enum AuthorizationMode {
    case none
    case device
    case auth
}

struct AuthResponse: Decodable {
    let authToken: String
    let user: AuthUser
    let company: AuthCompany
    let device: AuthDevice
}

struct AuthUser: Decodable {
    let id: Int
    let name: String?
    let account: String
    let phone: String?
    let role: String
}

struct AuthCompany: Decodable {
    let id: Int
    let name: String
    let taxId: String
    let address: String?
    let hasAppKeyConfigured: Bool
    let deviceLimit: Int
    let deviceUsed: Int

    private enum CodingKeys: String, CodingKey {
        case id, name, taxId, address, hasAppKeyConfigured, deviceLimit, deviceUsed
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        taxId = try container.decode(String.self, forKey: .taxId)
        address = try container.decodeIfPresent(String.self, forKey: .address)
        hasAppKeyConfigured = try container.decode(Bool.self, forKey: .hasAppKeyConfigured)
        deviceLimit = try container.decodeIfPresent(Int.self, forKey: .deviceLimit) ?? 1
        deviceUsed = try container.decodeIfPresent(Int.self, forKey: .deviceUsed) ?? 0
    }
}

struct AuthDevice: Decodable {
    let id: String
    let token: String?
    let name: String
}

private struct EmptyRequest: Encodable {}

private struct FailedRequest: Encodable {
    let message: String
}

private struct StaffMembersResponse: Decodable {
    let members: [StaffMember]
}

private struct StaffMemberResponse: Decodable {
    let member: StaffMember
}

private struct StaffCreateRequest: Encodable {
    let account: String
    let password: String
    let name: String
    let phone: String
}

private struct StaffUpdateRequest: Encodable {
    let name: String
    let phone: String
    let isActive: Bool
}

private struct PasswordResetRequest: Encodable {
    let password: String
}

private struct DeviceUnbindRequest: Encodable {
    let unbindCode: String
}

private struct AuthRegisterRequest: Encodable {
    let name: String
    let phone: String
    let account: String
    let password: String
    let companyName: String
    let taxId: String
    let address: String
    let deviceName: String
    let installationId: String
    let platform: String
}

private struct AuthLoginRequest: Encodable {
    let account: String
    let password: String
    let deviceName: String
    let installationId: String
    let unbindCode: String?
    let platform: String
}

private struct CatalogCategoriesResponse: Decodable {
    let categories: [CatalogCategory]
}

private struct CatalogCategoryResponse: Decodable {
    let category: CatalogCategory
}

private struct CatalogCategoryUpsertRequest: Encodable {
    let name: String
    let sortOrder: Int
    let status: String
}

struct CatalogProductsResponse: Decodable {
    let priceDecimalPlaces: Int
    let products: [CatalogProduct]
}

private struct CatalogProductResponse: Decodable {
    let product: CatalogProduct
}

private struct CatalogProductUpsertRequest: Encodable {
    let categoryId: Int?
    let name: String
    let price: Int
    let imagePath: String?
    let status: String
    let taxType: String
    let sortOrder: Int
}

private struct CatalogSettingsUpdateRequest: Encodable {
    let priceDecimalPlaces: Int
}

struct InvoiceIssueItemRequest: Encodable, Equatable {
    let name: String
    let quantity: Int
    let unitPrice: Int
}

private struct InvoiceIssueRequest: Encodable {
    let orderId: String
    let buyerIdentifier: String?
    let totalAmount: Int
    let items: [InvoiceIssueItemRequest]
    let print: Bool
}

private struct ManagedInvoicesResponse: Decodable {
    let invoices: [ManagedInvoice]
}

private struct ManagedInvoiceResponse: Decodable {
    let invoice: ManagedInvoice
}

private struct InvoiceReprintResponse: Decodable {
    let printJobId: String
}

private struct CatalogSettingsResponse: Decodable {
    let priceDecimalPlaces: Int
}

private struct EmptyResponse: Decodable {
    let ok: Bool?
}

private struct ErrorResponse: Decodable {
    let error: String
    let code: String?
    let message: String?
    let fieldErrors: [FieldErrorResponse]?
    let deviceLimit: Int?
    let deviceUsed: Int?

    var displayMessage: String {
        if (code ?? error) == "device_limit_reached",
           let deviceLimit,
           let deviceUsed {
            return "此公司已綁定 \(deviceUsed) / \(deviceLimit) 支手機，請聯絡 OpenvoKao 調整配額或先解除舊手機。"
        }
        if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return message
        }
        return Self.localizedMessage(for: code ?? error)
    }

    private static func localizedMessage(for code: String) -> String {
        switch code {
        case "account_already_registered":
            return "這個帳號已經註冊。"
        case "account_invalid":
            return "帳號只能使用英文字母、數字、底線或減號。"
        case "company_tax_id_exists":
            return "這個統一編號已經註冊。"
        case "device_binding_locked":
            return "這個帳號已綁定其他手機，請輸入解除綁定碼後再登入。"
        case "device_limit_reached":
            return "此公司可綁定的手機數量已滿，請先解除舊手機或聯絡 OpenvoKao 調整上限。"
        case "forbidden":
            return "權限不足。"
        case "invalid_auth_token":
            return "登入已失效，請重新登入。"
        case "invalid_credentials":
            return "帳號或密碼不正確。"
        case "account_disabled":
            return "此員工帳號已停用，請聯絡老闆。"
        case "invalid_device_token":
            return "裝置授權已失效，請重新登入或重新綁定。"
        case "missing_auth_token":
            return "請先登入帳號。"
        case "missing_device_token":
            return "請先完成裝置綁定。"
        case "owner_required":
            return "此操作需要老闆權限。"
        case "unbind_code_invalid":
            return "解除綁定碼不正確。"
        case "password_too_short":
            return "密碼長度不足。"
        case "price_decimal_places_precision_loss":
            return "目前商品價格含有更細的小數，不能直接降低小數位數。"
        case "request_body_too_large":
            return "資料內容太大。"
        case "total_amount_mismatch":
            return "總金額必須等於所有品項小計加總。"
        default:
            if code.hasSuffix("_required") {
                return "這個欄位必填。"
            }
            if code.hasSuffix("_invalid") {
                return "這個欄位格式不正確。"
            }
            if code.hasSuffix("_too_long") {
                return "這個欄位太長。"
            }
            if code.hasSuffix("_too_many") {
                return "資料筆數太多。"
            }
            return code
        }
    }
}

private struct FieldErrorResponse: Decodable {
    let field: String
    let code: String
    let message: String?
}

private extension JSONDecoder {
    static var backend: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)

            if let date = ISO8601DateFormatter.backendWithFractionalSeconds.date(from: string) {
                return date
            }

            if let date = ISO8601DateFormatter.backend.date(from: string) {
                return date
            }

            if let date = DateFormatter.backendSQL.date(from: string) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid date: \(string)"
            )
        }
        return decoder
    }
}

private extension JSONEncoder {
    static var backend: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension ISO8601DateFormatter {
    static let backend: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let backendWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

extension DateFormatter {
    static let reportQuery: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let backendSQL: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}
