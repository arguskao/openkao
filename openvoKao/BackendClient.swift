import Foundation

struct BackendClient {
    let serverURL: String
    let deviceToken: String?
    let authToken: String?

    init(serverURL: String, deviceToken: String? = nil, authToken: String? = nil) {
        self.serverURL = serverURL
        self.deviceToken = deviceToken
        self.authToken = authToken
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
                platform: platform
            )
        )
    }

    func loginAccount(
        account: String,
        password: String,
        deviceName: String,
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

        return response.jobs.map { job in
            job.payload.printJob(remoteId: job.id)
        }
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
            authorization: .device
        )
        return response.categories
    }

    func createCatalogCategory(name: String, sortOrder: Int, status: String) async throws -> CatalogCategory {
        let response: CatalogCategoryResponse = try await request(
            path: "/api/catalog/categories",
            method: "POST",
            authorization: .device,
            body: CatalogCategoryUpsertRequest(name: name, sortOrder: sortOrder, status: status)
        )
        return response.category
    }

    func updateCatalogCategory(id: Int, name: String, sortOrder: Int, status: String) async throws -> CatalogCategory {
        let response: CatalogCategoryResponse = try await request(
            path: "/api/catalog/categories/\(id)",
            method: "PUT",
            authorization: .device,
            body: CatalogCategoryUpsertRequest(name: name, sortOrder: sortOrder, status: status)
        )
        return response.category
    }

    func deleteCatalogCategory(id: Int) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/catalog/categories/\(id)",
            method: "DELETE",
            authorization: .device
        )
    }

    func fetchCatalogProducts() async throws -> CatalogProductsResponse {
        try await request(
            path: "/api/catalog/products",
            method: "GET",
            authorization: .device
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
            authorization: .device,
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
            authorization: .device,
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
            authorization: .device,
            body: CatalogSettingsUpdateRequest(priceDecimalPlaces: priceDecimalPlaces)
        )
        return response.priceDecimalPlaces
    }

    func deleteCatalogProduct(id: Int) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/catalog/products/\(id)",
            method: "DELETE",
            authorization: .device
        )
    }

    func fetchSalesInvoices(startDate: Date, endDate: Date) async throws -> [SalesInvoice] {
        let formatter = DateFormatter.reportQuery
        let response: SalesInvoicesResponse = try await request(
            path: "/api/reports/sales?startDate=\(formatter.string(from: startDate))&endDate=\(formatter.string(from: endDate))",
            method: "GET",
            authorization: .auth
        )
        return response.invoices
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

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let error = try? JSONDecoder.backend.decode(ErrorResponse.self, from: data)
            throw BackendError.server(error?.error ?? "HTTP \(httpResponse.statusCode)")
        }

        return try JSONDecoder.backend.decode(ResponseBody.self, from: data)
    }
}

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
    case server(String)

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
        case .server(let message):
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
    let items: [RemotePrintJobItem]
    let qrCodePayload: String?
    let barcodePayload: String?

    func printJob(remoteId: String) -> PrintJob {
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
            items: items.map { $0.printJobItem() },
            qrCodePayload: qrCodePayload,
            barcodePayload: barcodePayload,
            status: .pending,
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
}

struct AuthCompany: Decodable {
    let id: Int
    let name: String
    let taxId: String
    let address: String?
    let appKey: String
}

struct AuthDevice: Decodable {
    let id: String
    let token: String
    let name: String
}

private struct EmptyRequest: Encodable {}

private struct FailedRequest: Encodable {
    let message: String
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
    let platform: String
}

private struct AuthLoginRequest: Encodable {
    let account: String
    let password: String
    let deviceName: String
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

private struct CatalogSettingsResponse: Decodable {
    let priceDecimalPlaces: Int
}

private struct SalesInvoicesResponse: Decodable {
    let invoices: [SalesInvoice]
}

private struct EmptyResponse: Decodable {
    let ok: Bool?
}

private struct ErrorResponse: Decodable {
    let error: String
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

private extension DateFormatter {
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
