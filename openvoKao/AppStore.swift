import Combine
import Foundation

@MainActor
final class AppStore: ObservableObject {
    @Published var printJobs: [PrintJob] {
        didSet { save(printJobs, key: printJobsKey) }
    }

    @Published var deviceProfile: DeviceProfile {
        didSet { save(deviceProfile, key: deviceProfileKey) }
    }

    @Published var companyProfile: CompanyProfile {
        didSet { save(companyProfile, key: companyProfileKey) }
    }

    @Published var authSession: AuthSession {
        didSet { save(authSession, key: authSessionKey) }
    }

    @Published var catalogCategories: [CatalogCategory] {
        didSet { save(catalogCategories, key: catalogCategoriesKey) }
    }

    @Published var catalogProducts: [CatalogProduct] {
        didSet { save(catalogProducts, key: catalogProductsKey) }
    }

    @Published var catalogPriceDecimalPlaces: Int {
        didSet { save(catalogPriceDecimalPlaces, key: catalogPriceDecimalPlacesKey) }
    }

    @Published private(set) var isSyncing = false
    @Published private(set) var syncMessage: String?

    private let printJobsKey = "printJobs"
    private let deviceProfileKey = "deviceProfile"
    private let companyProfileKey = "companyProfile"
    private let authSessionKey = "authSession"
    private let catalogCategoriesKey = "catalogCategories"
    private let catalogProductsKey = "catalogProducts"
    private let catalogPriceDecimalPlacesKey = "catalogPriceDecimalPlaces"

    init() {
        printJobs = Self.load([PrintJob].self, key: printJobsKey) ?? Self.samplePrintJobs
        deviceProfile = Self.load(DeviceProfile.self, key: deviceProfileKey) ?? .initial
        companyProfile = Self.load(CompanyProfile.self, key: companyProfileKey) ?? .initial
        authSession = Self.load(AuthSession.self, key: authSessionKey) ?? .empty
        catalogCategories = Self.load([CatalogCategory].self, key: catalogCategoriesKey) ?? []
        catalogProducts = Self.load([CatalogProduct].self, key: catalogProductsKey) ?? []
        catalogPriceDecimalPlaces = Self.load(Int.self, key: catalogPriceDecimalPlacesKey) ?? 0
    }

    var isAuthenticated: Bool {
        authSession.isAuthenticated
    }

    var pendingJobs: [PrintJob] {
        printJobs.filter { $0.status == .pending }
    }

    var printedJobs: [PrintJob] {
        printJobs.filter { $0.status != .pending }
    }

    func markPrinted(_ job: PrintJob) {
        updateJob(job.id) { current in
            current.status = .printed
            current.lastMessage = "已送出列印"
        }
    }

    func markFailed(_ job: PrintJob, message: String) {
        updateJob(job.id) { current in
            current.status = .failed
            current.lastMessage = message
        }
    }

    func refreshPendingJobs() async {
        isSyncing = true
        syncMessage = "同步中"
        defer { isSyncing = false }

        do {
            let jobs = try await backendClient.fetchPendingPrintJobs()
            let history = printJobs.filter { $0.status != .pending }
            printJobs = history + jobs
            deviceProfile.isBound = true
            syncMessage = "已同步 \(jobs.count) 筆待列印"
        } catch {
            syncMessage = error.localizedDescription
        }
    }

    func refreshCatalog() async {
        isSyncing = true
        syncMessage = "同步商品中"
        defer { isSyncing = false }

        do {
            async let categories = backendClient.fetchCatalogCategories()
            async let productPayload = backendClient.fetchCatalogProducts()
            catalogCategories = try await categories.sorted {
                if $0.sortOrder == $1.sortOrder {
                    return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                return $0.sortOrder < $1.sortOrder
            }
            let products = try await productPayload
            catalogPriceDecimalPlaces = products.priceDecimalPlaces
            catalogProducts = products.products.sorted {
                if $0.sortOrder == $1.sortOrder {
                    return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                return $0.sortOrder < $1.sortOrder
            }
            syncMessage = "已同步 \(catalogCategories.count) 個分類、\(catalogProducts.count) 個商品"
        } catch {
            syncMessage = error.localizedDescription
        }
    }

    func createCategory(name: String, sortOrder: Int, status: String) async throws {
        _ = try await backendClient.createCatalogCategory(name: name, sortOrder: sortOrder, status: status)
        await refreshCatalog()
    }

    func updateCategory(id: Int, name: String, sortOrder: Int, status: String) async throws {
        _ = try await backendClient.updateCatalogCategory(id: id, name: name, sortOrder: sortOrder, status: status)
        await refreshCatalog()
    }

    func deleteCategory(id: Int) async throws {
        try await backendClient.deleteCatalogCategory(id: id)
        await refreshCatalog()
    }

    func createProduct(
        categoryId: Int?,
        name: String,
        price: Int,
        imagePath: String?,
        status: String,
        taxType: String,
        sortOrder: Int
    ) async throws {
        _ = try await backendClient.createCatalogProduct(
            categoryId: categoryId,
            name: name,
            price: price,
            imagePath: imagePath,
            status: status,
            taxType: taxType,
            sortOrder: sortOrder
        )
        await refreshCatalog()
    }

    func updateProduct(
        id: Int,
        categoryId: Int?,
        name: String,
        price: Int,
        imagePath: String?,
        status: String,
        taxType: String,
        sortOrder: Int
    ) async throws {
        _ = try await backendClient.updateCatalogProduct(
            id: id,
            categoryId: categoryId,
            name: name,
            price: price,
            imagePath: imagePath,
            status: status,
            taxType: taxType,
            sortOrder: sortOrder
        )
        await refreshCatalog()
    }

    func updateCatalogPriceDecimalPlaces(_ value: Int) async throws {
        _ = try await backendClient.updateCatalogPriceSettings(priceDecimalPlaces: value)
        await refreshCatalog()
    }

    func deleteProduct(id: Int) async throws {
        try await backendClient.deleteCatalogProduct(id: id)
        await refreshCatalog()
    }

    func verifyDeviceBinding() async {
        isSyncing = true
        syncMessage = "檢查綁定中"
        defer { isSyncing = false }

        do {
            let device = try await backendClient.fetchDevice()
            deviceProfile.deviceName = device.name
            deviceProfile.isBound = device.isBound
            deviceProfile.backendDeviceId = device.id
            deviceProfile.companyName = device.companyName
            deviceProfile.storeName = device.storeName
            deviceProfile.lastVerifiedAt = Date()
            syncMessage = "已綁定：\(device.companyName ?? device.name)"
        } catch {
            deviceProfile.isBound = false
            deviceProfile.backendDeviceId = nil
            deviceProfile.companyName = nil
            deviceProfile.storeName = nil
            deviceProfile.lastVerifiedAt = nil
            syncMessage = error.localizedDescription
        }
    }

    func markPrintedAndReport(_ job: PrintJob) async {
        markPrinted(job)

        do {
            try await backendClient.reportPrinted(remoteId: job.remoteId)
            syncMessage = "已回報列印成功：\(job.invoiceNumber)"
        } catch {
            updateJob(job.id) { current in
                current.lastMessage = "本機已列印，回報失敗：\(error.localizedDescription)"
            }
            syncMessage = error.localizedDescription
        }
    }

    func markFailedAndReport(_ job: PrintJob, message: String) async {
        markFailed(job, message: message)

        do {
            try await backendClient.reportFailed(remoteId: job.remoteId, message: message)
            syncMessage = "已回報列印失敗：\(job.invoiceNumber)"
        } catch {
            updateJob(job.id) { current in
                current.lastMessage = "列印失敗，回報也失敗：\(error.localizedDescription)"
            }
            syncMessage = error.localizedDescription
        }
    }

    func resetSampleJobs() {
        printJobs = Self.samplePrintJobs
    }

    func updateCompanyProfile(_ profile: CompanyProfile) {
        companyProfile = profile
    }

    func clearCompanyProfile() {
        companyProfile = .initial
    }

    func registerAccount(
        name: String,
        phone: String,
        account: String,
        password: String,
        companyName: String,
        taxId: String,
        address: String
    ) async throws {
        let response = try await authClient.registerAccount(
            name: name,
            phone: phone,
            account: account,
            password: password,
            companyName: companyName,
            taxId: taxId,
            address: address,
            deviceName: deviceProfile.deviceName
        )
        applyAuth(response)
        await verifyDeviceBinding()
        await refreshCatalog()
    }

    func loginAccount(account: String, password: String) async throws {
        let response = try await authClient.loginAccount(
            account: account,
            password: password,
            deviceName: deviceProfile.deviceName
        )
        applyAuth(response)
        await verifyDeviceBinding()
        await refreshCatalog()
    }

    func restoreAuthSession() async {
        guard authSession.isAuthenticated else { return }

        do {
            let response = try await authClient.fetchAuthMe()
            applyAuth(response)
            await verifyDeviceBinding()
            await refreshCatalog()
        } catch {
            logoutLocally()
            syncMessage = error.localizedDescription
        }
    }

    func logoutAccount() async {
        do {
            try await authClient.logoutAccount()
        } catch {
            syncMessage = error.localizedDescription
        }
        logoutLocally()
    }

    func updateDeviceToken(_ token: String) {
        deviceProfile.deviceToken = token
        deviceProfile.isBound = false
        deviceProfile.backendDeviceId = nil
        deviceProfile.companyName = nil
        deviceProfile.storeName = nil
        deviceProfile.lastVerifiedAt = nil
    }

    private var backendClient: BackendClient {
        BackendClient(
            serverURL: deviceProfile.serverURL,
            deviceToken: deviceProfile.deviceToken
        )
    }

    private var authClient: BackendClient {
        BackendClient(
            serverURL: deviceProfile.serverURL,
            authToken: authSession.authToken
        )
    }

    private func applyAuth(_ response: AuthResponse) {
        authSession = AuthSession(
            authToken: response.authToken,
            userId: response.user.id,
            userName: response.user.name ?? "",
            account: response.user.account,
            phone: response.user.phone ?? "",
            companyId: response.company.id,
            companyName: response.company.name,
            taxId: response.company.taxId,
            address: response.company.address ?? "",
            appKey: response.company.appKey
        )

        companyProfile = CompanyProfile(
            memberName: response.user.name ?? "",
            phone: response.user.phone ?? "",
            email: response.user.account,
            companyName: response.company.name,
            taxId: response.company.taxId,
            address: response.company.address ?? "",
            appKey: response.company.appKey
        )

        deviceProfile.deviceToken = response.device.token
        deviceProfile.deviceName = response.device.name
        deviceProfile.isBound = true
        deviceProfile.backendDeviceId = response.device.id
        deviceProfile.companyName = response.company.name
        deviceProfile.storeName = response.device.storeName
        deviceProfile.lastVerifiedAt = Date()
    }

    private func logoutLocally() {
        authSession = .empty
        catalogCategories = []
        catalogProducts = []
        catalogPriceDecimalPlaces = 0
        companyProfile = .initial
        deviceProfile.deviceToken = ""
        deviceProfile.isBound = false
        deviceProfile.backendDeviceId = nil
        deviceProfile.companyName = nil
        deviceProfile.storeName = nil
        deviceProfile.lastVerifiedAt = nil
    }

    private func updateJob(_ id: UUID, mutate: (inout PrintJob) -> Void) {
        guard let index = printJobs.firstIndex(where: { $0.id == id }) else { return }
        mutate(&printJobs[index])
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder.app.encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder.app.decode(type, from: data)
    }

    private static let samplePrintJobs: [PrintJob] = [
        PrintJob(
            id: UUID(),
            remoteId: "demo-001",
            invoiceNumber: "AB12345678",
            randomNumber: "5678",
            issuedAt: Date(),
            sellerName: "OpenvoKao 測試店",
            sellerIdentifier: "12345678",
            buyerIdentifier: nil,
            totalAmount: 150,
            items: [
                PrintJobItem(id: UUID(), name: "一般商品", quantity: 1, unitPrice: 100),
                PrintJobItem(id: UUID(), name: "服務費", quantity: 1, unitPrice: 50)
            ],
            qrCodePayload: "AB12345678567820260709150",
            barcodePayload: "AB12345678",
            status: .pending,
            lastMessage: nil
        ),
        PrintJob(
            id: UUID(),
            remoteId: "demo-002",
            invoiceNumber: "AB12345679",
            randomNumber: "9012",
            issuedAt: Date().addingTimeInterval(-3600),
            sellerName: "OpenvoKao 測試店",
            sellerIdentifier: "12345678",
            buyerIdentifier: "24536806",
            totalAmount: 300,
            items: [
                PrintJobItem(id: UUID(), name: "測試商品", quantity: 2, unitPrice: 150)
            ],
            qrCodePayload: "AB12345679901220260709300",
            barcodePayload: "AB12345679",
            status: .pending,
            lastMessage: nil
        )
    ]
}

private extension JSONEncoder {
    static var app: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var app: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
