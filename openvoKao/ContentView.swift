import SwiftUI
import SafariServices

struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedTab: AppTab = .initial
    @State private var didRestoreSession = false

    var body: some View {
        Group {
            if store.isAuthenticated {
                TabView(selection: $selectedTab) {
                    PrintQueueView()
                        .tabItem {
                            Label("待列印", systemImage: "list.bullet.rectangle")
                        }
                        .tag(AppTab.queue)

                    PrinterSettingsView()
                        .tabItem {
                            Label("印表機", systemImage: "printer")
                        }
                        .tag(AppTab.printer)

                    SalesReportView()
                        .tabItem {
                            Label("業績", systemImage: "chart.bar.xaxis")
                        }
                        .tag(AppTab.backend)

                    ProductCatalogView()
                        .tabItem {
                            Label("商品", systemImage: "shippingbox")
                        }
                        .tag(AppTab.history)

                    InvoiceManagementView()
                        .tabItem {
                            Label("發票", systemImage: "doc.text")
                        }
                        .tag(AppTab.settings)
                }
            } else {
                AuthGatewayView()
            }
        }
        .environmentObject(store)
        .task {
            guard !didRestoreSession else { return }
            didRestoreSession = true
            await store.restoreAuthSession()
        }
    }
}

private enum AppTab {
    case queue
    case printer
    case backend
    case history
    case settings

    static var initial: AppTab {
        ProcessInfo.processInfo.arguments.contains("-startSettings") ? .settings : .queue
    }
}

struct SalesReportView: View {
    @EnvironmentObject private var store: AppStore
    @State private var startDate = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var endDate = Date()
    @State private var grouping: SalesReportGrouping = .product
    @State private var showInvoiceList = false
    @State private var salesInvoices: [SalesInvoice] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                VStack(spacing: 12) {
                    HStack(spacing: 12) {
                        DatePicker(
                            "開始",
                            selection: $startDate,
                            in: ...endDate,
                            displayedComponents: .date
                        )
                        .datePickerStyle(.compact)

                        DatePicker(
                            "結束",
                            selection: $endDate,
                            in: startDate...Date(),
                            displayedComponents: .date
                        )
                        .datePickerStyle(.compact)
                    }

                    HStack {
                        Picker("依照", selection: $grouping) {
                            ForEach(SalesReportGrouping.allCases) { item in
                                Text(item.title).tag(item)
                            }
                        }
                        .pickerStyle(.menu)

                        Spacer()

                        Button(showInvoiceList ? "返回報表" : "查看發票列表") {
                            showInvoiceList.toggle()
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 8)

                if isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if showInvoiceList {
                    invoiceListView
                } else {
                    reportView
                }
            }
            .navigationTitle("業績報表")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await loadSalesData() }
                    } label: {
                        if isLoading {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isLoading)
                }
            }
            .task {
                await loadSalesData()
            }
            .onChange(of: startDate) { _ in
                Task { await loadSalesData() }
            }
            .onChange(of: endDate) { _ in
                Task { await loadSalesData() }
            }
        }
    }

    private var reportView: some View {
        VStack(spacing: 0) {
            if reportRows.isEmpty {
                Spacer()
                Text("~ 搜尋不到資料 ~")
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                VStack(spacing: 0) {
                    SalesReportHeader(quantityTitle: grouping.quantityTitle)

                    List {
                        ForEach(reportRows) { row in
                            HStack {
                                Text(row.name)
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                Text("\(row.quantity)")
                                    .frame(width: 72, alignment: .center)
                                    .monospacedDigit()

                                Text(currency(row.total))
                                    .frame(width: 110, alignment: .trailing)
                                    .monospacedDigit()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .listStyle(.plain)

                    HStack {
                        Text("總計")
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("\(reportRows.reduce(0) { $0 + $1.quantity })")
                            .frame(width: 72, alignment: .center)
                            .monospacedDigit()

                        Text(currency(reportRows.reduce(0) { $0 + $1.total }))
                            .frame(width: 110, alignment: .trailing)
                            .monospacedDigit()
                    }
                    .font(.headline)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
                }
            }
        }
    }

    private var invoiceListView: some View {
        Group {
            if salesInvoices.isEmpty {
                Spacer()
                Text("沒有發票資料")
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                List {
                    ForEach(salesInvoices) { invoice in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("發票: \(invoice.invoiceNumber)")
                            Text("商品: \(invoice.items.map { $0.name }.joined(separator: "、"))")
                            Text("數量: \(invoice.items.reduce(0) { $0 + $1.quantity })")
                            Text("總金額: \(currency(invoice.totalAmount))")
                            Text("建立時間: \(DateFormatter.receipt.string(from: invoice.issuedAt))")
                            Text("列印狀態: \(invoice.printStatus.title)")
                        }
                        .font(.body)
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private var reportRows: [SalesReportRow] {
        var grouped: [String: SalesReportRow] = [:]

        switch grouping {
        case .product:
            for invoice in salesInvoices {
                for item in invoice.items {
                    let existing = grouped[item.name] ?? SalesReportRow(name: item.name, quantity: 0, total: 0)
                    grouped[item.name] = SalesReportRow(
                        name: item.name,
                        quantity: existing.quantity + item.quantity,
                        total: existing.total + item.amount
                    )
                }
            }
        case .status:
            for invoice in salesInvoices {
                let key = invoice.printStatus.title
                let existing = grouped[key] ?? SalesReportRow(name: key, quantity: 0, total: 0)
                grouped[key] = SalesReportRow(
                    name: key,
                    quantity: existing.quantity + 1,
                    total: existing.total + invoice.totalAmount
                )
            }
        }

        return grouped.values.sorted {
            if $0.total == $1.total {
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            return $0.total > $1.total
        }
    }

    private func loadSalesData() async {
        guard store.isAuthenticated else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            salesInvoices = try await store.fetchSalesInvoices(startDate: startDate, endDate: endDate)
        } catch {
            salesInvoices = []
            errorMessage = error.localizedDescription
        }
    }
}

private enum SalesReportGrouping: String, CaseIterable, Identifiable {
    case product
    case status

    var id: String { rawValue }

    var title: String {
        switch self {
        case .product:
            return "商品"
        case .status:
            return "列印狀態"
        }
    }

    var quantityTitle: String {
        switch self {
        case .product:
            return "總數量"
        case .status:
            return "總筆數"
        }
    }
}

private struct SalesReportRow: Identifiable {
    let id = UUID()
    let name: String
    let quantity: Int
    let total: Int
}

private struct SalesReportHeader: View {
    let quantityTitle: String

    var body: some View {
        HStack {
            Text("項目名稱")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(quantityTitle)
                .frame(width: 72, alignment: .center)
            Text("總金額")
                .frame(width: 110, alignment: .trailing)
        }
        .font(.headline)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }
}

struct PrintQueueView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var printerManager: PrinterManager
    @State private var selectedJob: PrintJob?
    @State private var alert: AppAlert?

    var body: some View {
        NavigationView {
            List {
                Section {
                    PrinterStatusSummary()
                }

                if let syncMessage = store.syncMessage {
                    Section("同步") {
                        Text(syncMessage)
                            .foregroundColor(.secondary)
                    }
                }

                Section("待列印任務") {
                    if store.pendingJobs.isEmpty {
                        Text("目前沒有待列印任務")
                            .foregroundColor(.secondary)
                    }

                    ForEach(store.pendingJobs) { job in
                        Button {
                            selectedJob = job
                        } label: {
                            PrintJobRow(job: job)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("列印端")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        store.resetSampleJobs()
                    } label: {
                        Image(systemName: "shippingbox")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task {
                            await store.refreshPendingJobs()
                        }
                    } label: {
                        if store.isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(store.isSyncing)
                }
            }
            .sheet(item: $selectedJob) { job in
                PrintJobDetailView(job: job) {
                    Task {
                        await print(job)
                    }
                }
                .environmentObject(printerManager)
            }
            .alert(item: $alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func print(_ job: PrintJob) async {
        do {
            try printerManager.print(job)
            await store.markPrintedAndReport(job)
            selectedJob = nil
            alert = AppAlert(title: "已送出列印", message: job.invoiceNumber)
        } catch {
            await store.markFailedAndReport(job, message: error.localizedDescription)
            alert = AppAlert(title: "列印失敗", message: error.localizedDescription)
        }
    }
}

struct PrintJobDetailView: View {
    let job: PrintJob
    let onPrint: () -> Void
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var printerManager: PrinterManager

    var body: some View {
        NavigationView {
            List {
                Section("發票") {
                    ReadOnlyRow(title: "號碼", value: job.invoiceNumber)
                    ReadOnlyRow(title: "隨機碼", value: job.randomNumber)
                    ReadOnlyRow(title: "時間", value: DateFormatter.receipt.string(from: job.issuedAt))
                    ReadOnlyRow(title: "買方統編", value: job.buyerIdentifier ?? "無")
                    ReadOnlyRow(title: "總金額", value: currency(job.totalAmount))
                }

                Section("明細") {
                    ForEach(job.items) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name)
                                Text("x \(item.quantity)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text(currency(item.amount))
                                .monospacedDigit()
                        }
                    }
                }

                Section("印表機") {
                    ReadOnlyRow(title: "狀態", value: printerManager.connectedPrinterName ?? "未連線")
                    ReadOnlyRow(title: "服務", value: printerManager.isPrinterReady ? "已準備好" : "未準備")
                }
            }
            .navigationTitle("列印預覽")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("關閉") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("列印") { onPrint() }
                        .disabled(!printerManager.isPrinterReady)
                }
            }
        }
    }
}

struct PrintHistoryView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        NavigationView {
            List {
                if store.printedJobs.isEmpty {
                    Text("尚無商品")
                        .foregroundColor(.secondary)
                }

                ForEach(store.printedJobs) { job in
                    PrintJobRow(job: job)
                }
            }
            .navigationTitle("商品")
        }
    }
}

struct InvoiceManagementView: View {
    @EnvironmentObject private var store: AppStore
    @EnvironmentObject private var printerManager: PrinterManager
    @State private var selectedDate = Date()
    @State private var currentPage = 1
    @State private var selectedJob: PrintJob?
    @State private var alert: AppAlert?

    private let itemsPerPage = 15

    private var filteredJobs: [PrintJob] {
        let calendar = Calendar.current
        return store.printJobs
            .filter { calendar.isDate($0.issuedAt, inSameDayAs: selectedDate) }
            .sorted { lhs, rhs in
                if lhs.issuedAt == rhs.issuedAt {
                    return lhs.invoiceNumber > rhs.invoiceNumber
                }
                return lhs.issuedAt > rhs.issuedAt
            }
    }

    private var totalPages: Int {
        max(1, Int(ceil(Double(filteredJobs.count) / Double(itemsPerPage))))
    }

    private var pagedJobs: [PrintJob] {
        let startIndex = max(0, min((currentPage - 1) * itemsPerPage, filteredJobs.count))
        let endIndex = min(startIndex + itemsPerPage, filteredJobs.count)
        guard startIndex < endIndex else { return [] }
        return Array(filteredJobs[startIndex..<endIndex])
    }

    private var companyDisplayName: String {
        let trimmed = store.authSession.companyName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "目前公司" : trimmed
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                VStack(spacing: 12) {
                    DatePicker(
                        "發票日期",
                        selection: $selectedDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    .labelsHidden()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                    if let syncMessage = store.syncMessage {
                        Text(syncMessage)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 8)

                if pagedJobs.isEmpty {
                    Spacer()
                    InvoiceEmptyState(selectedDate: selectedDate)
                    Spacer()
                } else {
                    List {
                        ForEach(pagedJobs) { job in
                            Button {
                                selectedJob = job
                            } label: {
                                InvoiceRow(job: job)
                            }
                            .buttonStyle(.plain)
                        }
                }
                    .listStyle(.plain)
                }

                VStack(spacing: 14) {
                    HStack(spacing: 12) {
                        Button("上一頁") {
                            guard currentPage > 1 else { return }
                            currentPage -= 1
                        }
                        .buttonStyle(.bordered)
                        .disabled(currentPage <= 1)

                        Text("第 \(currentPage) / \(totalPages) 頁")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Button("下一頁") {
                            guard currentPage < totalPages else { return }
                            currentPage += 1
                        }
                        .buttonStyle(.bordered)
                        .disabled(currentPage >= totalPages)
                    }

                    Text(companyDisplayName)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundColor(.white)
                        .background(Color.blue)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .navigationTitle("發票管理")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(role: .destructive) {
                        Task {
                            await store.logoutAccount()
                        }
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task {
                            await store.refreshPendingJobs()
                        }
                    } label: {
                        if store.isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(store.isSyncing || store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onChange(of: selectedDate) { _ in
                currentPage = 1
            }
            .onChange(of: store.printJobs) { _ in
                currentPage = min(currentPage, totalPages)
            }
            .sheet(item: $selectedJob) { job in
                InvoiceDetailView(
                    job: job,
                    canPrint: printerManager.isPrinterReady
                ) {
                    Task {
                        await reprint(job)
                    }
                }
                .environmentObject(printerManager)
            }
            .alert(item: $alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func reprint(_ job: PrintJob) async {
        do {
            try printerManager.print(job)
            await store.markPrintedAndReport(job)
            selectedJob = nil
            alert = AppAlert(title: "已送出列印", message: job.invoiceNumber)
        } catch {
            await store.markFailedAndReport(job, message: error.localizedDescription)
            alert = AppAlert(title: "列印失敗", message: error.localizedDescription)
        }
    }
}

private struct InvoiceEmptyState: View {
    let selectedDate: Date

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 28))
                .foregroundColor(.secondary)
            Text("沒有發票記錄")
                .font(.headline)
            Text(DateFormatter.invoiceDate.string(from: selectedDate))
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }
}

private struct InvoiceRow: View {
    let job: PrintJob

    var body: some View {
        HStack(spacing: 12) {
            Text(job.invoiceNumber)
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(currency(job.totalAmount))
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .frame(width: 90, alignment: .trailing)

            StatusBadge(status: job.status)
                .frame(width: 74)

            Image(systemName: "square.and.pencil")
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 6)
    }
}

private struct InvoiceDetailView: View {
    let job: PrintJob
    let canPrint: Bool
    let onPrint: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                Section("發票資訊") {
                    ReadOnlyRow(title: "號碼", value: job.invoiceNumber)
                    ReadOnlyRow(title: "狀態", value: job.status.rawValue)
                    ReadOnlyRow(title: "時間", value: DateFormatter.receipt.string(from: job.issuedAt))
                    ReadOnlyRow(title: "隨機碼", value: job.randomNumber)
                    ReadOnlyRow(title: "總金額", value: currency(job.totalAmount))
                }

                Section("營業人") {
                    ReadOnlyRow(title: "公司", value: job.sellerName ?? "未提供")
                    ReadOnlyRow(title: "統編", value: job.sellerIdentifier ?? "未提供")
                    ReadOnlyRow(title: "買方統編", value: job.buyerIdentifier ?? "無")
                }

                Section("商品明細") {
                    ForEach(job.items) { item in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name)
                                Text("單價 \(currency(item.unitPrice)) x \(item.quantity)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text(currency(item.amount))
                                .monospacedDigit()
                        }
                        .padding(.vertical, 2)
                    }
                }

                if let lastMessage = job.lastMessage, !lastMessage.isEmpty {
                    Section("處理結果") {
                        Text(lastMessage)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("發票明細")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("關閉") { dismiss() }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(job.status == .pending ? "列印" : "補印") {
                        onPrint()
                    }
                    .disabled(!canPrint)
                }
            }
        }
    }
}

private struct WebDestination: Identifiable {
    let id = UUID()
    let url: URL
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

private struct PrinterStatusSummary: View {
    @EnvironmentObject private var printerManager: PrinterManager

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: printerManager.isPrinterReady ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(printerManager.isPrinterReady ? .green : .orange)
                Text(printerManager.isPrinterReady ? "印表機已準備好" : "請先連線印表機")
                    .font(.headline)
            }

            Text(printerManager.connectedPrinterName ?? printerManager.statusMessage ?? "尚未連線")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct PrintJobRow: View {
    let job: PrintJob

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(job.title)
                    .font(.body.weight(.semibold))
                Spacer()
                StatusBadge(status: job.status)
            }

            HStack {
                Text(DateFormatter.receipt.string(from: job.issuedAt))
                Spacer()
                Text(currency(job.totalAmount))
                    .monospacedDigit()
            }
            .font(.caption)
            .foregroundColor(.secondary)

            if let lastMessage = job.lastMessage {
                Text(lastMessage)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct StatusBadge: View {
    let status: PrintJobStatus

    var body: some View {
        Text(status.rawValue)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(backgroundColor)
            .foregroundColor(.white)
            .cornerRadius(6)
    }

    private var backgroundColor: Color {
        switch status {
        case .pending:
            return .blue
        case .printed:
            return .green
        case .failed:
            return .red
        }
    }
}

struct ReadOnlyRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }
}

private struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

func currency(_ amount: Int) -> String {
    "$\(amount)"
}

private extension DateFormatter {
    static let invoiceDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let receipt: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy/MM/dd HH:mm"
        return formatter
    }()
}

private extension Color {
    static let memberHeader = Color(red: 0.91, green: 0.885, blue: 0.945)
    static let memberBackground = Color(red: 0.985, green: 0.975, blue: 0.99)
    static let memberCard = Color(red: 0.995, green: 0.992, blue: 1)
    static let memberFieldBorder = Color(red: 0.36, green: 0.36, blue: 0.38)
    static let memberLabel = Color(red: 0.42, green: 0.42, blue: 0.45)
}

#Preview {
    ContentView()
        .environmentObject(AppStore())
        .environmentObject(PrinterManager())
}
