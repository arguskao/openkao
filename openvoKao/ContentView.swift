import SwiftUI
import SafariServices

struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedTab: AppTab = .initial

    var body: some View {
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

            BackendPortalView()
                .tabItem {
                    Label("後台", systemImage: "globe")
                }
                .tag(AppTab.backend)

            PrintHistoryView()
                .tabItem {
                    Label("紀錄", systemImage: "clock")
                }
                .tag(AppTab.history)

            DeviceSettingsView {
                selectedTab = .queue
            }
                .tabItem {
                    Label("設定", systemImage: "gearshape")
                }
                .tag(AppTab.settings)
        }
        .environmentObject(store)
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

struct BackendPortalView: View {
    @EnvironmentObject private var store: AppStore
    @State private var destination: WebDestination?
    @State private var alert: AppAlert?

    var body: some View {
        NavigationView {
            Form {
                Section("後台") {
                    Button {
                        openBackend()
                    } label: {
                        Label("開啟後台", systemImage: "safari")
                    }
                }

                Section("裝置") {
                    ReadOnlyRow(title: "綁定狀態", value: store.deviceProfile.isBound ? "已綁定" : "尚未綁定")
                    ReadOnlyRow(title: "裝置名稱", value: store.deviceProfile.deviceName)
                    if let companyName = store.deviceProfile.companyName {
                        ReadOnlyRow(title: "公司", value: companyName)
                    }
                    if let storeName = store.deviceProfile.storeName {
                        ReadOnlyRow(title: "門市", value: storeName)
                    }
                    if let lastVerifiedAt = store.deviceProfile.lastVerifiedAt {
                        ReadOnlyRow(title: "最後檢查", value: DateFormatter.receipt.string(from: lastVerifiedAt))
                    }

                    Button {
                        Task {
                            await store.verifyDeviceBinding()
                        }
                    } label: {
                        Label("檢查綁定", systemImage: "checkmark.shield")
                    }
                    .disabled(store.isSyncing)
                }
            }
            .navigationTitle("後台")
            .task {
                guard !store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                await store.verifyDeviceBinding()
            }
            .sheet(item: $destination) { destination in
                SafariView(url: destination.url)
            }
            .alert(item: $alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func openBackend() {
        guard let url = URL(string: store.deviceProfile.serverURL),
              ["http", "https"].contains(url.scheme?.lowercased()) else {
            alert = AppAlert(title: "無法開啟後台", message: "請先在設定填入有效的伺服器 URL")
            return
        }

        destination = WebDestination(url: url)
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
                    Text("尚無列印紀錄")
                        .foregroundColor(.secondary)
                }

                ForEach(store.printedJobs) { job in
                    PrintJobRow(job: job)
                }
            }
            .navigationTitle("列印紀錄")
        }
    }
}

struct DeviceSettingsView: View {
    let onHome: () -> Void
    @EnvironmentObject private var store: AppStore
    @State private var draftProfile = CompanyProfile.initial
    @State private var isEditingProfile = false
    @State private var editingSection: MemberSection?
    @State private var alert: AppAlert?
    @State private var isShowingDeleteConfirmation = false

    var body: some View {
        ZStack {
            Color.memberBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                MemberCenterHeader(onHome: onHome)

                ScrollView {
                    VStack(spacing: 24) {
                        MemberCard(
                            title: "會員資料",
                            isEditing: editingSection == .member,
                            onEdit: { beginEditing(.member) },
                            fields: {
                                FloatingTextField(
                                    title: "會員名稱",
                                    text: $draftProfile.memberName,
                                    isEnabled: editingSection == .member,
                                    keyboardType: .namePhonePad
                                )
                                FloatingTextField(
                                    title: "手機號碼",
                                    text: $draftProfile.phone,
                                    isEnabled: editingSection == .member,
                                    keyboardType: .phonePad
                                )
                                FloatingTextField(
                                    title: "電子郵件",
                                    text: $draftProfile.email,
                                    isEnabled: editingSection == .member,
                                    keyboardType: .emailAddress,
                                    autocorrectionDisabled: true
                                )
                            }
                        )

                        MemberCard(
                            title: "公司資料",
                            isEditing: editingSection == .company,
                            onEdit: { beginEditing(.company) },
                            fields: {
                                FloatingTextField(
                                    title: "統一編號",
                                    text: $draftProfile.taxId,
                                    isEnabled: editingSection == .company,
                                    keyboardType: .numberPad
                                )
                                FloatingTextField(
                                    title: "公司地址",
                                    text: $draftProfile.address,
                                    isEnabled: editingSection == .company
                                )
                                FloatingTextField(
                                    title: "App Key",
                                    text: $draftProfile.appKey,
                                    isEnabled: editingSection == .company,
                                    autocorrectionDisabled: true
                                )
                            }
                        )

                        if isEditingProfile {
                            MemberActionBar(
                                onSave: saveProfile,
                                onCancel: cancelProfileEditing,
                                onDelete: { isShowingDeleteConfirmation = true }
                            )
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 20)
                    .padding(.bottom, 28)
                }
            }
        }
        .onAppear {
            draftProfile = store.companyProfile
        }
        .task {
            guard !store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            await store.verifyDeviceBinding()
        }
        .alert(item: $alert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("好"))
            )
        }
        .confirmationDialog("確定要清除會員中心資料嗎？", isPresented: $isShowingDeleteConfirmation, titleVisibility: .visible) {
            Button("刪除帳號", role: .destructive) {
                store.clearCompanyProfile()
                draftProfile = store.companyProfile
                isEditingProfile = false
                editingSection = nil
            }
            Button("取消", role: .cancel) {}
        }
    }

    private func beginEditing(_ section: MemberSection) {
        draftProfile = store.companyProfile
        editingSection = section
        isEditingProfile = true
    }

    private func saveProfile() {
        let trimmedMemberName = draftProfile.memberName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = draftProfile.phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = draftProfile.email.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedMemberName.isEmpty,
              !trimmedPhone.isEmpty,
              !trimmedEmail.isEmpty else {
            alert = AppAlert(title: "資料未完成", message: "請填寫會員名稱、手機號碼和電子郵件")
            return
        }

        draftProfile.memberName = trimmedMemberName
        draftProfile.phone = trimmedPhone
        draftProfile.email = trimmedEmail
        draftProfile.companyName = draftProfile.companyName.trimmingCharacters(in: .whitespacesAndNewlines)
        draftProfile.taxId = draftProfile.taxId.trimmingCharacters(in: .whitespacesAndNewlines)
        draftProfile.address = draftProfile.address.trimmingCharacters(in: .whitespacesAndNewlines)
        draftProfile.appKey = draftProfile.appKey.trimmingCharacters(in: .whitespacesAndNewlines)

        store.updateCompanyProfile(draftProfile)
        isEditingProfile = false
        editingSection = nil
    }

    private func cancelProfileEditing() {
        draftProfile = store.companyProfile
        isEditingProfile = false
        editingSection = nil
    }
}

private enum MemberSection {
    case member
    case company
}

private struct MemberCenterHeader: View {
    let onHome: () -> Void

    var body: some View {
        ZStack {
            Color.memberHeader

            HStack {
                Button(action: onHome) {
                    Image(systemName: "house.fill")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundColor(.black)
                        .frame(width: 64, height: 64)
                }
                .buttonStyle(.plain)

                Spacer()
            }
            .padding(.horizontal, 22)
            .padding(.top, 26)

            Text("會員中心")
                .font(.system(size: 32, weight: .semibold))
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.top, 26)
        }
        .frame(height: 120)
    }
}

private struct MemberCard<Fields: View>: View {
    let title: String
    let isEditing: Bool
    let onEdit: () -> Void
    @ViewBuilder let fields: Fields

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                Spacer()

                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundColor(isEditing ? .blue : .black)
                        .frame(width: 48, height: 48)
                        .background(Color.black.opacity(0.06))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }

            fields
        }
        .padding(.horizontal, 16)
        .padding(.top, 22)
        .padding(.bottom, 22)
        .background(Color.memberCard)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.black.opacity(0.06), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 3, x: 0, y: 2)
    }
}

private struct FloatingTextField: View {
    let title: String
    @Binding var text: String
    var isEnabled: Bool
    var keyboardType: UIKeyboardType = .default
    var autocorrectionDisabled = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextField("", text: $text)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(autocorrectionDisabled)
                .disabled(!isEnabled)
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .frame(minHeight: 66)
                .background(Color.white)
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(Color.memberFieldBorder, lineWidth: 2)
                )

            Text(title)
                .font(.system(size: 17, weight: .medium))
                .foregroundColor(Color.memberLabel)
                .padding(.horizontal, 8)
                .background(Color.memberCard)
                .offset(x: 18, y: -10)
        }
        .padding(.top, 12)
    }
}

private struct MemberActionBar: View {
    let onSave: () -> Void
    let onCancel: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Button(action: onSave) {
                    Label("儲存", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button(action: onCancel) {
                    Label("取消", systemImage: "xmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            Button(role: .destructive, action: onDelete) {
                Label("刪除帳號", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
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
