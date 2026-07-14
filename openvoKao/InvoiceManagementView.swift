import SwiftUI

struct InvoiceManagementView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedDate = Date()
    @State private var invoices: [ManagedInvoice] = []
    @State private var selectedInvoice: ManagedInvoice?
    @State private var alert: AppAlert?
    @State private var refreshTask: Task<Void, Never>?

    private var companyDisplayName: String {
        let name = store.authSession.companyName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "目前公司" : name
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    DatePicker(
                        "發票日期",
                        selection: $selectedDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)

                    if let message = store.invoiceSyncStatus.message {
                        Text(message)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)

                if invoices.isEmpty && !store.invoiceSyncStatus.isSyncing {
                    Spacer()
                    VStack(spacing: 10) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.system(size: 28))
                            .foregroundColor(.secondary)
                        Text("沒有發票記錄")
                            .font(.headline)
                        Text(DateFormatter.invoiceDate.string(from: selectedDate))
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                } else {
                    List(invoices) { invoice in
                        Button {
                            selectedInvoice = invoice
                        } label: {
                            ManagedInvoiceRow(invoice: invoice)
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }

                Text(companyDisplayName)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .foregroundColor(.white)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(16)
            }
            .navigationTitle("發票管理")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(role: .destructive) {
                        Task { await store.logoutAccount() }
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: loadInvoices) {
                        if store.invoiceSyncStatus.isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(store.invoiceSyncStatus.isSyncing)
                }
            }
            .onAppear(perform: loadInvoices)
            .onChange(of: selectedDate) { _ in loadInvoices() }
            .onDisappear {
                refreshTask?.cancel()
                refreshTask = nil
            }
            .sheet(item: $selectedInvoice) { invoice in
                ManagedInvoiceDetailView(invoice: invoice, onChanged: loadInvoices)
                    .environmentObject(store)
            }
            .alert(item: $alert) { value in
                Alert(title: Text(value.title), message: Text(value.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func loadInvoices() {
        refreshTask?.cancel()
        refreshTask = Task {
            do {
                invoices = try await store.fetchInvoices(date: selectedDate)
            } catch {
                guard !Task.isCancelled else { return }
                alert = AppAlert(title: "同步失敗", message: error.localizedDescription)
            }
        }
    }
}

private struct ManagedInvoiceRow: View {
    let invoice: ManagedInvoice

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(invoice.displayNumber)
                    .font(.body.weight(.semibold))
                Text(DateFormatter.receipt.string(from: invoice.issuedAt))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(currency(invoice.totalAmount))
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .frame(width: 78, alignment: .trailing)

            ManagedInvoiceStatusLabel(status: invoice.status)
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 6)
    }
}

private struct ManagedInvoiceDetailView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var invoice: ManagedInvoice
    @State private var isWorking = false
    @State private var alert: AppAlert?
    @State private var confirmVoid = false
    let onChanged: () -> Void

    init(invoice: ManagedInvoice, onChanged: @escaping () -> Void) {
        _invoice = State(initialValue: invoice)
        self.onChanged = onChanged
    }

    var body: some View {
        NavigationView {
            List {
                Section("發票資訊") {
                    ReadOnlyRow(title: "號碼", value: invoice.invoiceNumber ?? "尚未取得")
                    ReadOnlyRow(title: "訂單", value: invoice.orderId ?? "未提供")
                    ReadOnlyRow(title: "狀態", value: invoice.status.title)
                    ReadOnlyRow(title: "時間", value: DateFormatter.receipt.string(from: invoice.issuedAt))
                    ReadOnlyRow(title: "隨機碼", value: invoice.randomNumber ?? "尚未取得")
                    ReadOnlyRow(title: "總金額", value: currency(invoice.totalAmount))
                }

                Section("營業人") {
                    ReadOnlyRow(title: "公司", value: invoice.sellerName ?? "未提供")
                    ReadOnlyRow(title: "統編", value: invoice.sellerIdentifier ?? "未提供")
                    ReadOnlyRow(title: "買方統編", value: invoice.buyerIdentifier ?? "無")
                }

                if !invoice.items.isEmpty {
                    Section("商品明細") {
                        ForEach(invoice.items) { item in
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.name)
                                    Text("單價 \(currency(item.unitPrice)) x \(item.quantity)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Text(currency(item.amount)).monospacedDigit()
                            }
                        }
                    }
                }

                if invoice.invoiceNumber != nil {
                    Section("操作") {
                        Button(action: refreshFromAmego) {
                            Label("向 Amego 補查", systemImage: "arrow.clockwise")
                        }
                        .disabled(isWorking || invoice.status == .voided)

                        Button(action: requestReprint) {
                            Label("建立補印工作", systemImage: "printer")
                        }
                        .disabled(isWorking || invoice.status == .voided)

                        if store.isOwner {
                            Button(role: .destructive) { confirmVoid = true } label: {
                                Label("作廢發票", systemImage: "xmark.circle")
                            }
                            .disabled(isWorking || invoice.status == .voided)
                        }
                    }
                }
            }
            .navigationTitle("發票明細")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("關閉") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isWorking { ProgressView() }
                }
            }
            .confirmationDialog("確定作廢這張發票？", isPresented: $confirmVoid, titleVisibility: .visible) {
                Button("確定作廢", role: .destructive, action: voidInvoice)
                Button("取消", role: .cancel) {}
            } message: {
                Text("作廢後不能補印，也不會刪除原始發票紀錄。")
            }
            .alert(item: $alert) { value in
                Alert(title: Text(value.title), message: Text(value.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func refreshFromAmego() {
        perform {
            invoice = try await store.refreshInvoice(id: invoice.id)
            onChanged()
        }
    }

    private func requestReprint() {
        perform {
            try await store.requestInvoiceReprint(id: invoice.id)
            onChanged()
            alert = AppAlert(title: "已建立補印工作", message: "列印工作已加入目前裝置佇列。")
        }
    }

    private func voidInvoice() {
        perform {
            try await store.voidInvoice(id: invoice.id)
            invoice.status = .voided
            invoice.voidedAt = Date()
            onChanged()
        }
    }

    private func perform(_ operation: @escaping () async throws -> Void) {
        isWorking = true
        Task {
            do {
                try await operation()
            } catch {
                alert = AppAlert(title: "操作失敗", message: error.localizedDescription)
            }
            isWorking = false
        }
    }
}

private struct ManagedInvoiceStatusLabel: View {
    let status: ManagedInvoiceStatus

    var body: some View {
        Text(status.title)
            .font(.caption.weight(.semibold))
            .foregroundColor(color)
            .frame(width: 58, alignment: .trailing)
    }

    private var color: Color {
        switch status {
        case .issuing, .printPending: return .orange
        case .issued: return .blue
        case .printed: return .green
        case .printFailed, .voided: return .red
        }
    }
}
