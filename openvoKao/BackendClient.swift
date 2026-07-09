import Foundation

struct BackendClient {
    let serverURL: String
    let deviceToken: String

    func fetchDevice() async throws -> BackendDevice {
        try await request(
            path: "/api/devices/me",
            method: "GET"
        )
    }

    func fetchPendingPrintJobs() async throws -> [PrintJob] {
        let response: PendingPrintJobsResponse = try await request(
            path: "/api/print-jobs/pending",
            method: "GET"
        )

        return response.jobs.map { job in
            job.payload.printJob(remoteId: job.id)
        }
    }

    func reportPrinted(remoteId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/print-jobs/\(remoteId)/printed",
            method: "POST",
            body: EmptyRequest()
        )
    }

    func reportFailed(remoteId: String, message: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/print-jobs/\(remoteId)/failed",
            method: "POST",
            body: FailedRequest(message: message)
        )
    }

    private func request<ResponseBody: Decodable>(
        path: String,
        method: String
    ) async throws -> ResponseBody {
        try await request(path: path, method: method, body: Optional<EmptyRequest>.none)
    }

    private func request<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        method: String,
        body: RequestBody?
    ) async throws -> ResponseBody {
        guard !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BackendError.missingServerURL
        }

        guard !deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BackendError.missingDeviceToken
        }

        guard let baseURL = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidServerURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(deviceToken.trimmingCharacters(in: .whitespacesAndNewlines))", forHTTPHeaderField: "Authorization")

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
    let companyId: String
    let companyName: String?
    let storeId: String?
    let storeName: String?
    let lastSeenAt: String?
    let isBound: Bool
}

enum BackendError: LocalizedError {
    case missingServerURL
    case missingDeviceToken
    case invalidServerURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .missingServerURL:
            return "請先設定伺服器 URL"
        case .missingDeviceToken:
            return "請先設定裝置 token"
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

private struct EmptyRequest: Encodable {}

private struct FailedRequest: Encodable {
    let message: String
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
    static let backendSQL: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}
