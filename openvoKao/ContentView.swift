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
                    IssueInvoiceView()
                        .tabItem {
                            Label("開發票", systemImage: "doc.badge.plus")
                        }
                        .tag(AppTab.issue)

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
    case issue
    case queue
    case printer
    case backend
    case history
    case settings

    static var initial: AppTab {
        ProcessInfo.processInfo.arguments.contains("-startSettings") ? .settings : .issue
    }
}

struct SalesReportView: View {
    @EnvironmentObject private var store: AppStore
    @State private var startDate = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var endDate = Date()
    @State private var grouping: SalesReportGrouping = .product
    @State private var showInvoiceList = false
    @State private var reportSummary = SalesReportSummary(
        byProduct: [],
        byStatus: [],
        totalQuantity: 0,
        totalAmount: 0
    )
    @State private var salesInvoices: [SalesInvoice] = []
    @State private var nextCursor: String?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var errorMessage: String?
    @State private var loadTask: Task<Void, Never>?

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
                        scheduleReload()
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
                scheduleReload()
            }
            .onChange(of: startDate) { _ in
                scheduleReload()
            }
            .onChange(of: endDate) { _ in
                scheduleReload()
            }
            .onDisappear {
                loadTask?.cancel()
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

                        Text("\(reportSummary.totalQuantity)")
                            .frame(width: 72, alignment: .center)
                            .monospacedDigit()

                        Text(currency(reportSummary.totalAmount))
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

                    if nextCursor != nil {
                        HStack {
                            Spacer()
                            Button(isLoadingMore ? "載入中..." : "載入更多") {
                                Task { await loadMoreInvoices() }
                            }
                            .disabled(isLoadingMore)
                            Spacer()
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    private var reportRows: [SalesReportRow] {
        switch grouping {
        case .product:
            return reportSummary.byProduct.map { SalesReportRow(name: $0.name, quantity: $0.quantity, total: $0.total) }
        case .status:
            return reportSummary.byStatus.map { SalesReportRow(name: $0.name, quantity: $0.quantity, total: $0.total) }
        }
    }

    private func scheduleReload() {
        loadTask?.cancel()
        loadTask = Task {
            await loadSalesData(reset: true)
        }
    }

    private func loadSalesData(reset: Bool) async {
        guard store.isAuthenticated else { return }
        if reset {
            isLoading = true
            errorMessage = nil
        } else {
            isLoadingMore = true
        }
        defer {
            if reset {
                isLoading = false
            } else {
                isLoadingMore = false
            }
        }

        do {
            let payload = try await store.fetchSalesReport(
                startDate: startDate,
                endDate: endDate,
                cursor: reset ? nil : nextCursor
            )
            guard !Task.isCancelled else { return }
            if reset {
                reportSummary = payload.report
                salesInvoices = payload.invoices
            } else {
                salesInvoices += payload.invoices
            }
            nextCursor = payload.nextCursor
        } catch {
            guard !Task.isCancelled else { return }
            if reset {
                salesInvoices = []
                nextCursor = nil
                reportSummary = SalesReportSummary(byProduct: [], byStatus: [], totalQuantity: 0, totalAmount: 0)
            }
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreInvoices() async {
        guard nextCursor != nil, !isLoadingMore else { return }
        await loadSalesData(reset: false)
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
    @State private var refreshTask: Task<Void, Never>?

    var body: some View {
        NavigationView {
            List {
                Section {
                    PrinterStatusSummary()
                }

                if let syncMessage = printQueueSyncMessage {
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        startRefreshPendingJobs()
                    } label: {
                        if store.queueSyncStatus.isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(store.queueSyncStatus.isSyncing)
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
            .onDisappear {
                refreshTask?.cancel()
                refreshTask = nil
            }
        }
    }

    private var printQueueSyncMessage: String? {
        store.reportSyncStatus.message ?? store.queueSyncStatus.message
    }

    private func startRefreshPendingJobs() {
        refreshTask?.cancel()
        refreshTask = Task {
            await store.refreshPendingJobs()
        }
    }

    private func print(_ job: PrintJob) async {
        do {
            store.markSending(job)
            try await printerManager.print(job)
            await store.markPrintedAndReport(job)
            selectedJob = nil
            alert = AppAlert(title: "已送至印表機", message: job.invoiceNumber)
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
                        .disabled(!printerManager.isPrinterReady || printerManager.isPrinting)
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
                Image(systemName: printerManager.isPrinting ? "arrow.triangle.2.circlepath.circle.fill" : (printerManager.isPrinterReady ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"))
                    .foregroundColor(printerManager.isPrinting ? .blue : (printerManager.isPrinterReady ? .green : .orange))
                Text(printerManager.isPrinting ? "資料傳送中" : (printerManager.isPrinterReady ? "印表機已準備好" : "請先連線印表機"))
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
        case .printing:
            return .orange
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

struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

func currency(_ amount: Int) -> String {
    "$\(amount)"
}

extension DateFormatter {
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
