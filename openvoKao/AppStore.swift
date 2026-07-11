import Combine
import Foundation

@MainActor
final class AppStore: ObservableObject {
    private static let authTokenKeychainKey = "authToken"
    private static let deviceTokenKeychainKey = "deviceToken"

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

    @Published private(set) var printReportOutbox: [PrintReportOutboxItem] {
        didSet { save(printReportOutbox, key: printReportOutboxKey) }
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
    private let printReportOutboxKey = "printReportOutbox"
    private let maxStoredPrintJobs = 300
    private let maxStoredPrintJobAgeDays = 30

    init() {
        let persistedJobs = Self.load([PrintJob].self, key: printJobsKey) ?? []
        let loadedOutbox = Self.load([PrintReportOutboxItem].self, key: printReportOutboxKey) ?? []
        printReportOutbox = loadedOutbox
        printJobs = persistedJobs.filter { !$0.remoteId.hasPrefix("demo-") }
        var loadedDeviceProfile = Self.load(DeviceProfile.self, key: deviceProfileKey) ?? .initial
        companyProfile = Self.load(CompanyProfile.self, key: companyProfileKey) ?? .initial
        var loadedAuthSession = Self.load(AuthSession.self, key: authSessionKey) ?? .empty
        catalogCategories = Self.load([CatalogCategory].self, key: catalogCategoriesKey) ?? []
        catalogProducts = Self.load([CatalogProduct].self, key: catalogProductsKey) ?? []
        catalogPriceDecimalPlaces = Self.load(Int.self, key: catalogPriceDecimalPlacesKey) ?? 0

        loadedDeviceProfile.deviceToken = Self.migrateSensitiveValue(
            legacyValue: loadedDeviceProfile.deviceToken,
            keychainKey: Self.deviceTokenKeychainKey
        )
        if loadedDeviceProfile.installationId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            loadedDeviceProfile.installationId = UUID().uuidString
        }
        deviceProfile = loadedDeviceProfile

        loadedAuthSession.authToken = Self.migrateSensitiveValue(
            legacyValue: loadedAuthSession.authToken,
            keychainKey: Self.authTokenKeychainKey
        )
        authSession = loadedAuthSession

        save(deviceProfile, key: deviceProfileKey)
        save(authSession, key: authSessionKey)
        printJobs = prunePrintJobs(printJobs)
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
        updateJob(job) { current in
            current.status = .printed
            current.lastMessage = "已送至印表機，請確認是否完成出紙"
        }
    }

    func markSending(_ job: PrintJob) {
        updateJob(job) { current in
            current.lastMessage = "資料傳送中，尚未完成"
        }
    }

    func markFailed(_ job: PrintJob, message: String) {
        updateJob(job) { current in
            current.status = .failed
            current.lastMessage = message
        }
    }

    func refreshPendingJobs() async {
        isSyncing = true
        syncMessage = "同步中"
        defer { isSyncing = false }

        do {
            await flushPrintReportOutbox()
            let jobs = try await backendClient.fetchPendingPrintJobs()
            mergeFetchedPrintJobs(jobs)
            deviceProfile.isBound = true
            let outboxSuffix = printReportOutbox.isEmpty ? "" : "，\(printReportOutbox.count) 筆回報待重試"
            syncMessage = "已同步 \(jobs.count) 筆待列印\(outboxSuffix)"
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
            deviceProfile.lastVerifiedAt = Date()
            syncMessage = "已綁定：\(device.companyName ?? device.name)"
        } catch {
            deviceProfile.isBound = false
            deviceProfile.backendDeviceId = nil
            deviceProfile.companyName = nil
            deviceProfile.lastVerifiedAt = nil
            syncMessage = error.localizedDescription
        }
    }

    func markPrintedAndReport(_ job: PrintJob) async {
        markPrinted(job)

        do {
            try await backendClient.reportPrinted(remoteId: job.remoteId)
            removePrintReportOutboxItem(remoteId: job.remoteId, status: .printed)
            syncMessage = "已回報送印完成：\(job.invoiceNumber)"
        } catch {
            enqueuePrintReport(remoteId: job.remoteId, status: .printed, message: nil, lastError: error.localizedDescription)
            updateJob(job) { current in
                current.lastMessage = "本機已列印，回報失敗：\(error.localizedDescription)"
            }
            syncMessage = error.localizedDescription
        }
    }

    func markFailedAndReport(_ job: PrintJob, message: String) async {
        markFailed(job, message: message)

        do {
            try await backendClient.reportFailed(remoteId: job.remoteId, message: message)
            removePrintReportOutboxItem(remoteId: job.remoteId, status: .failed)
            syncMessage = "已回報列印失敗：\(job.invoiceNumber)"
        } catch {
            enqueuePrintReport(remoteId: job.remoteId, status: .failed, message: message, lastError: error.localizedDescription)
            updateJob(job) { current in
                current.lastMessage = "列印失敗，回報也失敗：\(error.localizedDescription)"
            }
            syncMessage = error.localizedDescription
        }
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
            deviceName: deviceProfile.deviceName,
            installationId: deviceProfile.installationId
        )
        applyAuth(response)
        await verifyDeviceBinding()
        await refreshCatalog()
    }

    func loginAccount(account: String, password: String, unbindCode: String? = nil) async throws {
        let response = try await authClient.loginAccount(
            account: account,
            password: password,
            deviceName: deviceProfile.deviceName,
            installationId: deviceProfile.installationId,
            unbindCode: unbindCode
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
            await refreshPendingJobs()
        } catch {
            if (error as? BackendError)?.isAuthenticationFailure == true {
                logoutLocally()
            }
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
        deviceProfile.lastVerifiedAt = nil
        _ = KeychainStore.set(token.trimmingCharacters(in: .whitespacesAndNewlines), for: Self.deviceTokenKeychainKey)
    }

    func fetchSalesReport(startDate: Date, endDate: Date, cursor: String? = nil) async throws -> SalesReportPayload {
        try await authClient.fetchSalesReport(startDate: startDate, endDate: endDate, cursor: cursor)
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
            role: response.user.role,
            companyId: response.company.id,
            companyName: response.company.name,
            taxId: response.company.taxId,
            address: response.company.address ?? ""
        )

        companyProfile = CompanyProfile(
            memberName: response.user.name ?? "",
            phone: response.user.phone ?? "",
            email: response.user.account,
            companyName: response.company.name,
            taxId: response.company.taxId,
            address: response.company.address ?? "",
            hasAppKeyConfigured: response.company.hasAppKeyConfigured
        )

        if let token = response.device.token?.trimmingCharacters(in: .whitespacesAndNewlines),
           !token.isEmpty {
            deviceProfile.deviceToken = token
        }
        deviceProfile.deviceName = response.device.name
        deviceProfile.isBound = true
        deviceProfile.backendDeviceId = response.device.id
        deviceProfile.companyName = response.company.name
        deviceProfile.lastVerifiedAt = Date()
        persistSensitiveTokens()
    }

    private func logoutLocally() {
        authSession = .empty
        catalogCategories = []
        catalogProducts = []
        catalogPriceDecimalPlaces = 0
        printReportOutbox = []
        companyProfile = .initial
        deviceProfile.deviceToken = ""
        deviceProfile.isBound = false
        deviceProfile.backendDeviceId = nil
        deviceProfile.companyName = nil
        deviceProfile.lastVerifiedAt = nil
        KeychainStore.remove(Self.authTokenKeychainKey)
        KeychainStore.remove(Self.deviceTokenKeychainKey)
    }

    private func updateJob(_ job: PrintJob, mutate: (inout PrintJob) -> Void) {
        guard let index = printJobs.firstIndex(where: { $0.remoteId == job.remoteId || $0.id == job.id }) else { return }
        mutate(&printJobs[index])
    }

    private func mergeFetchedPrintJobs(_ fetchedJobs: [PrintJob]) {
        var mergedByRemoteId: [String: PrintJob] = [:]
        for job in printJobs {
            guard !job.remoteId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            mergedByRemoteId[job.remoteId] = job
        }

        for fetched in fetchedJobs {
            if let existing = mergedByRemoteId[fetched.remoteId] {
                var next = fetched
                next.id = existing.id
                if shouldKeepLocalJobState(existing) {
                    next.status = existing.status
                    next.lastMessage = existing.lastMessage
                }
                mergedByRemoteId[fetched.remoteId] = next
            } else {
                mergedByRemoteId[fetched.remoteId] = fetched
            }
        }

        let ordered = mergedByRemoteId.values.sorted {
            if $0.status == $1.status {
                return $0.issuedAt > $1.issuedAt
            }
            return statusSortRank($0.status) < statusSortRank($1.status)
        }
        printJobs = prunePrintJobs(ordered)
    }

    private func shouldKeepLocalJobState(_ job: PrintJob) -> Bool {
        job.status == .printed
            || job.status == .failed
            || printReportOutbox.contains { $0.remoteId == job.remoteId }
    }

    private func statusSortRank(_ status: PrintJobStatus) -> Int {
        switch status {
        case .pending, .printing:
            return 0
        case .failed:
            return 1
        case .printed:
            return 2
        }
    }

    private func prunePrintJobs(_ jobs: [PrintJob]) -> [PrintJob] {
        let protectedRemoteIds = Set(printReportOutbox.map(\.remoteId))
        let cutoff = Calendar.current.date(byAdding: .day, value: -maxStoredPrintJobAgeDays, to: Date()) ?? .distantPast
        let candidates = jobs.filter { job in
            !job.remoteId.hasPrefix("demo-")
                && (job.status == .pending
                    || job.status == .printing
                    || protectedRemoteIds.contains(job.remoteId)
                    || job.issuedAt >= cutoff)
        }

        var seenRemoteIds = Set<String>()
        let deduped = candidates.sorted { $0.issuedAt > $1.issuedAt }.filter { job in
            guard !seenRemoteIds.contains(job.remoteId) else { return false }
            seenRemoteIds.insert(job.remoteId)
            return true
        }

        let protectedJobs = deduped.filter {
            $0.status == .pending || $0.status == .printing || protectedRemoteIds.contains($0.remoteId)
        }
        let historicalJobs = deduped.filter { job in
            !protectedJobs.contains { $0.remoteId == job.remoteId }
        }
        return Array((protectedJobs + historicalJobs).prefix(maxStoredPrintJobs))
    }

    private func enqueuePrintReport(
        remoteId: String,
        status: PrintReportOutboxStatus,
        message: String?,
        lastError: String?
    ) {
        let next = PrintReportOutboxItem(remoteId: remoteId, status: status, message: message, lastError: lastError)
        if let index = printReportOutbox.firstIndex(where: { $0.id == next.id }) {
            printReportOutbox[index].message = message
            printReportOutbox[index].lastError = lastError
            printReportOutbox[index].updatedAt = Date()
        } else {
            printReportOutbox.append(next)
        }
    }

    private func removePrintReportOutboxItem(remoteId: String, status: PrintReportOutboxStatus) {
        let idempotencyKey = "\(remoteId):\(status.rawValue)"
        printReportOutbox.removeAll { $0.idempotencyKey == idempotencyKey }
    }

    private func flushPrintReportOutbox() async {
        guard !printReportOutbox.isEmpty else { return }

        let pendingReports = printReportOutbox
        for item in pendingReports {
            do {
                switch item.status {
                case .printed:
                    try await backendClient.reportPrinted(remoteId: item.remoteId)
                case .failed:
                    try await backendClient.reportFailed(remoteId: item.remoteId, message: item.message ?? "列印失敗")
                }
                removePrintReportOutboxItem(remoteId: item.remoteId, status: item.status)
            } catch {
                if let index = printReportOutbox.firstIndex(where: { $0.id == item.id }) {
                    printReportOutbox[index].attemptCount += 1
                    printReportOutbox[index].lastError = error.localizedDescription
                    printReportOutbox[index].updatedAt = Date()
                }
            }
        }
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder.app.encode(value) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private func persistSensitiveTokens() {
        _ = KeychainStore.set(authSession.authToken, for: Self.authTokenKeychainKey)
        _ = KeychainStore.set(deviceProfile.deviceToken, for: Self.deviceTokenKeychainKey)
    }

    private static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder.app.decode(type, from: data)
    }

    private static func migrateSensitiveValue(legacyValue: String, keychainKey: String) -> String {
        if let storedValue = KeychainStore.string(for: keychainKey),
           !storedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return storedValue
        }

        let trimmedLegacyValue = legacyValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLegacyValue.isEmpty else { return "" }
        _ = KeychainStore.set(trimmedLegacyValue, for: keychainKey)
        return trimmedLegacyValue
    }

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
