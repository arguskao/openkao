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

    @Published private(set) var isSyncing = false
    @Published private(set) var syncMessage: String?

    private let printJobsKey = "printJobs"
    private let deviceProfileKey = "deviceProfile"
    private let companyProfileKey = "companyProfile"

    init() {
        printJobs = Self.load([PrintJob].self, key: printJobsKey) ?? Self.samplePrintJobs
        deviceProfile = Self.load(DeviceProfile.self, key: deviceProfileKey) ?? .initial
        companyProfile = Self.load(CompanyProfile.self, key: companyProfileKey) ?? .initial
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
