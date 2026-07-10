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
    var items: [PrintJobItem]
    var qrCodePayload: String?
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
    case printed = "已列印"
    case failed = "列印失敗"

    var id: String { rawValue }
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

struct DeviceProfile: Codable, Equatable {
    var deviceName: String
    var serverURL: String
    var deviceToken: String
    var isBound: Bool
    var backendDeviceId: String?
    var companyName: String?
    var lastVerifiedAt: Date?

    static let initial = DeviceProfile(
        deviceName: "前台列印端",
        serverURL: "https://openvokao-backend.arguskao.workers.dev",
        deviceToken: "",
        isBound: false,
        backendDeviceId: nil,
        companyName: nil,
        lastVerifiedAt: nil
    )

    enum CodingKeys: String, CodingKey {
        case deviceName
        case serverURL
        case deviceToken
        case isBound
        case backendDeviceId
        case companyName
        case lastVerifiedAt
    }

    init(
        deviceName: String,
        serverURL: String,
        deviceToken: String,
        isBound: Bool,
        backendDeviceId: String?,
        companyName: String?,
        lastVerifiedAt: Date?
    ) {
        self.deviceName = deviceName
        self.serverURL = serverURL
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
        deviceToken = try container.decodeIfPresent(String.self, forKey: .deviceToken) ?? ""
        isBound = try container.decodeIfPresent(Bool.self, forKey: .isBound) ?? false
        backendDeviceId = try container.decodeIfPresent(String.self, forKey: .backendDeviceId)
        companyName = try container.decodeIfPresent(String.self, forKey: .companyName)
        lastVerifiedAt = try container.decodeIfPresent(Date.self, forKey: .lastVerifiedAt)
    }
}

struct AuthSession: Codable, Equatable {
    var authToken: String
    var userId: Int
    var userName: String
    var account: String
    var phone: String
    var companyId: Int
    var companyName: String
    var taxId: String
    var address: String
    var appKey: String

    static let empty = AuthSession(
        authToken: "",
        userId: 0,
        userName: "",
        account: "",
        phone: "",
        companyId: 0,
        companyName: "",
        taxId: "",
        address: "",
        appKey: ""
    )

    var isAuthenticated: Bool {
        !authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && companyId > 0
    }

    enum CodingKeys: String, CodingKey {
        case authToken
        case userId
        case userName
        case account
        case phone
        case companyId
        case companyName
        case taxId
        case address
        case appKey
    }

    init(
        authToken: String,
        userId: Int,
        userName: String,
        account: String,
        phone: String,
        companyId: Int,
        companyName: String,
        taxId: String,
        address: String,
        appKey: String
    ) {
        self.authToken = authToken
        self.userId = userId
        self.userName = userName
        self.account = account
        self.phone = phone
        self.companyId = companyId
        self.companyName = companyName
        self.taxId = taxId
        self.address = address
        self.appKey = appKey
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authToken = try container.decodeIfPresent(String.self, forKey: .authToken) ?? ""
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
        companyId = try container.decodeIfPresent(Int.self, forKey: .companyId) ?? 0
        companyName = try container.decodeIfPresent(String.self, forKey: .companyName) ?? ""
        taxId = try container.decodeIfPresent(String.self, forKey: .taxId) ?? ""
        address = try container.decodeIfPresent(String.self, forKey: .address) ?? ""
        appKey = try container.decodeIfPresent(String.self, forKey: .appKey) ?? ""
    }
}

struct CompanyProfile: Codable, Equatable {
    var memberName: String
    var phone: String
    var email: String
    var companyName: String
    var taxId: String
    var address: String
    var appKey: String

    static let initial = CompanyProfile(
        memberName: "",
        phone: "",
        email: "",
        companyName: "",
        taxId: "12345678",
        address: "",
        appKey: "sHeq7t8G1wiQvhAuIM27"
    )

    enum CodingKeys: String, CodingKey {
        case memberName
        case phone
        case email
        case companyName
        case legacyName = "name"
        case taxId
        case address
        case appKey
    }

    init(
        memberName: String,
        phone: String,
        email: String,
        companyName: String,
        taxId: String,
        address: String,
        appKey: String
    ) {
        self.memberName = memberName
        self.phone = phone
        self.email = email
        self.companyName = companyName
        self.taxId = taxId
        self.address = address
        self.appKey = appKey
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
        appKey = try container.decodeIfPresent(String.self, forKey: .appKey) ?? Self.initial.appKey
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(memberName, forKey: .memberName)
        try container.encode(phone, forKey: .phone)
        try container.encode(email, forKey: .email)
        try container.encode(companyName, forKey: .companyName)
        try container.encode(taxId, forKey: .taxId)
        try container.encode(address, forKey: .address)
        try container.encode(appKey, forKey: .appKey)
    }
}
