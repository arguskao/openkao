import Foundation

struct PrintJob: Identifiable, Codable, Equatable {
    var id: UUID
    var remoteId: String
    var invoiceNumber: String
    var randomNumber: String
    var issuedAt: Date
    var sellerName: String?
    var sellerIdentifier: String?
    var buyerIdentifier: String?
    var totalAmount: Int
    var salesAmount: Int?
    var taxAmount: Int?
    var invoiceFormatCode: String?
    var isReprint: Bool?
    var items: [PrintJobItem]
    var qrCodePayload: String?
    var leftQRCodePayload: String?
    var rightQRCodePayload: String?
    var barcodePayload: String?
    var status: PrintJobStatus
    var lastMessage: String?

    var title: String {
        invoiceNumber
    }
}

struct PrintJobItem: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var quantity: Int
    var unitPrice: Int

    var amount: Int {
        quantity * unitPrice
    }
}

enum PrintJobStatus: String, Codable, CaseIterable, Identifiable {
    case pending = "待列印"
    case printing = "傳送中"
    case printed = "已列印"
    case failed = "列印失敗"

    var id: String { rawValue }
}

enum PrintReportOutboxStatus: String, Codable {
    case printed
    case failed
}

struct PrintReportOutboxItem: Identifiable, Codable, Equatable {
    var id: String
    var remoteId: String
    var status: PrintReportOutboxStatus
    var message: String?
    var idempotencyKey: String
    var attemptCount: Int
    var lastError: String?
    var updatedAt: Date

    init(remoteId: String, status: PrintReportOutboxStatus, message: String? = nil, lastError: String? = nil) {
        self.remoteId = remoteId
        self.status = status
        self.message = message
        self.idempotencyKey = "\(remoteId):\(status.rawValue)"
        self.id = idempotencyKey
        self.attemptCount = 0
        self.lastError = lastError
        self.updatedAt = Date()
    }
}

struct SalesInvoice: Identifiable, Codable, Equatable {
    var id: String
    var invoiceNumber: String
    var randomNumber: String
    var issuedAt: Date
    var sellerName: String?
    var sellerIdentifier: String?
    var buyerIdentifier: String?
    var totalAmount: Int
    var printStatus: SalesInvoiceStatus
    var items: [SalesInvoiceItem]
}

struct SalesInvoiceItem: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var quantity: Int
    var unitPrice: Int
    var amount: Int
}

enum SalesInvoiceStatus: String, Codable, CaseIterable, Identifiable {
    case pending
    case printed
    case failed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pending:
            return "待列印"
        case .printed:
            return "已列印"
        case .failed:
            return "列印失敗"
        }
    }
}

struct SalesReportSummaryRow: Identifiable, Codable, Equatable {
    var id: String { name }
    var name: String
    var quantity: Int
    var total: Int
}

struct SalesReportSummary: Codable, Equatable {
    var byProduct: [SalesReportSummaryRow]
    var byStatus: [SalesReportSummaryRow]
    var totalQuantity: Int
    var totalAmount: Int
}

struct SalesReportPayload: Codable, Equatable {
    var report: SalesReportSummary
    var invoices: [SalesInvoice]
    var nextCursor: String?
}

struct ManagedInvoice: Identifiable, Codable, Equatable {
    var id: String
    var orderId: String?
    var invoiceNumber: String?
    var status: ManagedInvoiceStatus
    var issuedAt: Date
    var invoiceDate: String?
    var invoiceTime: String?
    var randomNumber: String?
    var sellerName: String?
    var sellerIdentifier: String?
    var buyerIdentifier: String?
    var carrierType: String?
    var carrierId: String?
    var npoban: String?
    var totalAmount: Int
    var voidedAt: Date?
    var items: [SalesInvoiceItem]

    var displayNumber: String {
        invoiceNumber ?? orderId ?? id
    }
}

struct IssuedInvoice: Codable, Equatable {
    var issuanceId: String
    var status: String
    var orderId: String
    var invoiceId: String
    var invoiceNumber: String
    var randomNumber: String
    var printJobId: String?
}

enum ManagedInvoiceStatus: String, Codable, CaseIterable {
    case issuing
    case issued
    case printPending = "print_pending"
    case printed
    case printFailed = "print_failed"
    case voided

    var title: String {
        switch self {
        case .issuing: return "開立中"
        case .issued: return "已開立"
        case .printPending: return "待列印"
        case .printed: return "已列印"
        case .printFailed: return "列印失敗"
        case .voided: return "已作廢"
        }
    }
}

struct DeviceProfile: Codable, Equatable {
    var deviceName: String
    var serverURL: String
    var installationId: String
    var deviceToken: String
    var isBound: Bool
    var backendDeviceId: String?
    var companyName: String?
    var lastVerifiedAt: Date?

    static let initial = DeviceProfile(
        deviceName: "前台列印端",
        serverURL: "https://openvokao-backend.arguskao.workers.dev",
        installationId: UUID().uuidString,
        deviceToken: "",
        isBound: false,
        backendDeviceId: nil,
        companyName: nil,
        lastVerifiedAt: nil
    )

    enum CodingKeys: String, CodingKey {
        case deviceName
        case serverURL
        case installationId
        case isBound
        case backendDeviceId
        case companyName
        case lastVerifiedAt
        case legacyDeviceToken = "deviceToken"
    }

    init(
        deviceName: String,
        serverURL: String,
        installationId: String,
        deviceToken: String,
        isBound: Bool,
        backendDeviceId: String?,
        companyName: String?,
        lastVerifiedAt: Date?
    ) {
        self.deviceName = deviceName
        self.serverURL = serverURL
        self.installationId = installationId
        self.deviceToken = deviceToken
        self.isBound = isBound
        self.backendDeviceId = backendDeviceId
        self.companyName = companyName
        self.lastVerifiedAt = lastVerifiedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceName = try container.decodeIfPresent(String.self, forKey: .deviceName) ?? Self.initial.deviceName
        serverURL = try container.decodeIfPresent(String.self, forKey: .serverURL) ?? Self.initial.serverURL
        installationId = try container.decodeIfPresent(String.self, forKey: .installationId) ?? Self.initial.installationId
        deviceToken = try container.decodeIfPresent(String.self, forKey: .legacyDeviceToken) ?? ""
        isBound = try container.decodeIfPresent(Bool.self, forKey: .isBound) ?? false
        backendDeviceId = try container.decodeIfPresent(String.self, forKey: .backendDeviceId)
        companyName = try container.decodeIfPresent(String.self, forKey: .companyName)
        lastVerifiedAt = try container.decodeIfPresent(Date.self, forKey: .lastVerifiedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(serverURL, forKey: .serverURL)
        try container.encode(installationId, forKey: .installationId)
        try container.encode(isBound, forKey: .isBound)
        try container.encodeIfPresent(backendDeviceId, forKey: .backendDeviceId)
        try container.encodeIfPresent(companyName, forKey: .companyName)
        try container.encodeIfPresent(lastVerifiedAt, forKey: .lastVerifiedAt)
    }
}

struct AuthSession: Codable, Equatable {
    var authToken: String
    var userId: Int
    var userName: String
    var account: String
    var phone: String
    var role: String
    var companyId: Int
    var companyName: String
    var taxId: String
    var address: String
    var deviceLimit: Int
    var deviceUsed: Int

    static let empty = AuthSession(
        authToken: "",
        userId: 0,
        userName: "",
        account: "",
        phone: "",
        role: "staff",
        companyId: 0,
        companyName: "",
        taxId: "",
        address: "",
        deviceLimit: 1,
        deviceUsed: 0
    )

    var isAuthenticated: Bool {
        !authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && companyId > 0
    }

    enum CodingKeys: String, CodingKey {
        case legacyAuthToken = "authToken"
        case userId
        case userName
        case account
        case phone
        case role
        case companyId
        case companyName
        case taxId
        case address
        case deviceLimit
        case deviceUsed
    }

    init(
        authToken: String,
        userId: Int,
        userName: String,
        account: String,
        phone: String,
        role: String,
        companyId: Int,
        companyName: String,
        taxId: String,
        address: String,
        deviceLimit: Int,
        deviceUsed: Int
    ) {
        self.authToken = authToken
        self.userId = userId
        self.userName = userName
        self.account = account
        self.phone = phone
        self.role = role
        self.companyId = companyId
        self.companyName = companyName
        self.taxId = taxId
        self.address = address
        self.deviceLimit = deviceLimit
        self.deviceUsed = deviceUsed
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authToken = try container.decodeIfPresent(String.self, forKey: .legacyAuthToken) ?? ""
        if let numeric = try container.decodeIfPresent(Int.self, forKey: .userId) {
            userId = numeric
        } else if let legacy = try container.decodeIfPresent(String.self, forKey: .userId),
                  let numeric = Int(legacy) {
            userId = numeric
        } else {
            userId = 0
        }
        userName = try container.decodeIfPresent(String.self, forKey: .userName) ?? ""
        account = try container.decodeIfPresent(String.self, forKey: .account) ?? ""
        phone = try container.decodeIfPresent(String.self, forKey: .phone) ?? ""
        role = try container.decodeIfPresent(String.self, forKey: .role) ?? "staff"
        companyId = try container.decodeIfPresent(Int.self, forKey: .companyId) ?? 0
        companyName = try container.decodeIfPresent(String.self, forKey: .companyName) ?? ""
        taxId = try container.decodeIfPresent(String.self, forKey: .taxId) ?? ""
        address = try container.decodeIfPresent(String.self, forKey: .address) ?? ""
        deviceLimit = try container.decodeIfPresent(Int.self, forKey: .deviceLimit) ?? 1
        deviceUsed = try container.decodeIfPresent(Int.self, forKey: .deviceUsed) ?? 0
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userId, forKey: .userId)
        try container.encode(userName, forKey: .userName)
        try container.encode(account, forKey: .account)
        try container.encode(phone, forKey: .phone)
        try container.encode(role, forKey: .role)
        try container.encode(companyId, forKey: .companyId)
        try container.encode(companyName, forKey: .companyName)
        try container.encode(taxId, forKey: .taxId)
        try container.encode(address, forKey: .address)
        try container.encode(deviceLimit, forKey: .deviceLimit)
        try container.encode(deviceUsed, forKey: .deviceUsed)
    }
}

struct StaffMember: Identifiable, Decodable, Equatable {
    let id: Int
    let account: String
    let name: String
    let phone: String?
    let role: String
    let isActive: Bool
    let createdAt: String
    let updatedAt: String
}

struct ManagedCompanyDevice: Identifiable, Decodable, Equatable {
    let id: String
    let companyId: Int
    let name: String
    let platform: String
    let installationId: String?
    let lastSeenAt: String?
    let createdAt: String
    let updatedAt: String
}

struct ManagedCompanyDevices: Decodable, Equatable {
    let devices: [ManagedCompanyDevice]
    let deviceLimit: Int
    let deviceUsed: Int
}

struct CompanyProfile: Codable, Equatable {
    var memberName: String
    var phone: String
    var email: String
    var companyName: String
    var taxId: String
    var address: String
    var hasAppKeyConfigured: Bool

    static let initial = CompanyProfile(
        memberName: "",
        phone: "",
        email: "",
        companyName: "",
        taxId: "12345678",
        address: "",
        hasAppKeyConfigured: false
    )

    enum CodingKeys: String, CodingKey {
        case memberName
        case phone
        case email
        case companyName
        case legacyName = "name"
        case taxId
        case address
        case hasAppKeyConfigured
        case legacyAppKey = "appKey"
    }

    init(
        memberName: String,
        phone: String,
        email: String,
        companyName: String,
        taxId: String,
        address: String,
        hasAppKeyConfigured: Bool
    ) {
        self.memberName = memberName
        self.phone = phone
        self.email = email
        self.companyName = companyName
        self.taxId = taxId
        self.address = address
        self.hasAppKeyConfigured = hasAppKeyConfigured
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        memberName = try container.decodeIfPresent(String.self, forKey: .memberName) ?? ""
        phone = try container.decodeIfPresent(String.self, forKey: .phone) ?? ""
        email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
        companyName = try container.decodeIfPresent(String.self, forKey: .companyName)
            ?? container.decodeIfPresent(String.self, forKey: .legacyName)
            ?? ""
        taxId = try container.decodeIfPresent(String.self, forKey: .taxId) ?? Self.initial.taxId
        address = try container.decodeIfPresent(String.self, forKey: .address) ?? ""
        if let hasAppKeyConfigured = try container.decodeIfPresent(Bool.self, forKey: .hasAppKeyConfigured) {
            self.hasAppKeyConfigured = hasAppKeyConfigured
        } else {
            let legacyAppKey = try container.decodeIfPresent(String.self, forKey: .legacyAppKey) ?? ""
            self.hasAppKeyConfigured = !legacyAppKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberName, forKey: .memberName)
        try container.encode(phone, forKey: .phone)
        try container.encode(email, forKey: .email)
        try container.encode(companyName, forKey: .companyName)
        try container.encode(taxId, forKey: .taxId)
        try container.encode(address, forKey: .address)
        try container.encode(hasAppKeyConfigured, forKey: .hasAppKeyConfigured)
    }
}
