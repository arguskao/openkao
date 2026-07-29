import SwiftUI

struct IssueInvoiceView: View {
    @EnvironmentObject private var store: AppStore
    @State private var quantities: [Int: Int] = [:]
    @State private var variablePriceTexts: [Int: String] = [:]
    @State private var buyerIdentifier = ""
    @State private var discountType: CheckoutDiscountType?
    @State private var discountValueText = ""
    @State private var receivedAmountText = ""
    @State private var isIssuing = false
    @State private var alert: IssueInvoiceAlert?

    private var activeProducts: [CatalogProduct] {
        store.catalogProducts
            .filter { $0.status != "隱藏" }
            .sorted {
                if $0.sortOrder == $1.sortOrder {
                    return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                return $0.sortOrder < $1.sortOrder
            }
    }

    private var selectedProducts: [CatalogProduct] {
        activeProducts.filter { quantity(for: $0) > 0 }
    }

    private var totalQuantity: Int {
        selectedProducts.reduce(0) { $0 + quantity(for: $1) }
    }

    private var variablePriceError: String? {
        for product in selectedProducts where product.isVariablePrice {
            guard let price = parsedPrice(variablePriceTexts[product.id] ?? ""), price > 0 else {
                return "請輸入「\(product.name)」的現場單價。"
            }
        }
        return nil
    }

    private var orderLines: [CheckoutLine] {
        selectedProducts.compactMap { product in
            guard let unitPrice = unitPrice(for: product), unitPrice > 0 else { return nil }
            return CheckoutLine(id: product.id, name: product.name, quantity: quantity(for: product), unitPrice: unitPrice)
        }
    }

    private var subtotal: Int {
        orderLines.reduce(0) { $0 + $1.amount }
    }

    private var discount: CheckoutDiscount? {
        guard let discountType else { return nil }
        guard let value = Int(discountValueText), value >= 0 else { return nil }
        return CheckoutDiscount(type: discountType, value: value)
    }

    private var receivedAmount: Int? {
        guard !receivedAmountText.isEmpty else { return nil }
        return parsedPrice(receivedAmountText)
    }

    private var checkoutSummary: CheckoutSummary? {
        CheckoutCalculator.summary(
            subtotal: subtotal,
            discount: discount,
            receivedAmount: receivedAmount,
            defaultToExactPayment: receivedAmountText.isEmpty
        )
    }

    private var checkoutError: String? {
        guard totalQuantity > 0 else { return nil }
        if let variablePriceError { return variablePriceError }
        guard discountType == nil || discount != nil else { return "請輸入正確的折扣。" }
        guard let summary = checkoutSummary else { return "折扣不能超過訂單金額。" }
        guard let receivedAmount = summary.receivedAmount else { return "請輸入客人實收金額。" }
        guard receivedAmount >= summary.total else { return "實收金額不足，尚差 \(formatPrice(summary.total - receivedAmount))。" }
        return nil
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Form {
                    Section("買方") {
                        TextField("買方統編，可不填", text: $buyerIdentifier)
                            .keyboardType(.numberPad)
                            .onChange(of: buyerIdentifier) { value in
                                buyerIdentifier = String(value.filter(\.isNumber).prefix(8))
                            }
                    }

                    Section("商品") {
                        if activeProducts.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("目前沒有可開發票的商品", systemImage: "shippingbox")
                                    .foregroundColor(.secondary)
                                Button("重新同步") { Task { await store.refreshCatalog() } }
                            }
                            .padding(.vertical, 6)
                        } else {
                            ForEach(activeProducts) { product in
                                ProductQuantityRow(
                                    product: product,
                                    quantity: quantity(for: product),
                                    variablePriceText: Binding(
                                        get: { variablePriceTexts[product.id] ?? "" },
                                        set: { variablePriceTexts[product.id] = $0 }
                                    ),
                                    priceLabel: formatPrice(product.price),
                                    onDecrease: { setQuantity(quantity(for: product) - 1, for: product) },
                                    onIncrease: { setQuantity(quantity(for: product) + 1, for: product) }
                                )
                            }
                        }
                    }

                    if totalQuantity > 0 {
                        Section("折扣") {
                            Picker("折扣方式", selection: $discountType) {
                                Text("不使用折扣").tag(CheckoutDiscountType?.none)
                                ForEach(CheckoutDiscountType.allCases) { type in
                                    Text(type.title).tag(CheckoutDiscountType?.some(type))
                                }
                            }

                            if let discountType {
                                TextField(discountType == .amount ? "折抵金額" : "折數，例如 85", text: $discountValueText)
                                    .keyboardType(.numberPad)
                            }
                        }

                        Section("收款") {
                            TextField("實收金額（留空即不找零）", text: $receivedAmountText)
                                .keyboardType(.numberPad)
                            CheckoutSummaryRows(summary: checkoutSummary, hasDiscount: discountType != nil)
                        }
                    }
                }

                IssueInvoiceSummaryBar(
                    totalQuantity: totalQuantity,
                    summary: checkoutSummary,
                    error: checkoutError,
                    isIssuing: isIssuing || store.invoiceSyncStatus.isSyncing,
                    action: { Task { await issueInvoice() } }
                )
            }
            .navigationTitle("開發票")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { Task { await store.refreshCatalog() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(store.catalogSyncStatus.isSyncing)
                }
            }
            .task {
                if store.catalogProducts.isEmpty { await store.refreshCatalog() }
            }
            .alert(item: $alert) { item in
                Alert(title: Text(item.title), message: Text(item.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func quantity(for product: CatalogProduct) -> Int { quantities[product.id] ?? 0 }

    private func setQuantity(_ quantity: Int, for product: CatalogProduct) {
        quantities[product.id] = max(0, min(quantity, 999))
    }

    private func unitPrice(for product: CatalogProduct) -> Int? {
        product.isVariablePrice ? parsedPrice(variablePriceTexts[product.id] ?? "") : product.price
    }

    private func parsedPrice(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.allSatisfy(\.isNumber) else { return nil }
        return Int(trimmed)
    }

    private func issueInvoice() async {
        guard totalQuantity > 0 else {
            alert = IssueInvoiceAlert(title: "尚未選商品", message: "請先選擇至少一項商品。")
            return
        }
        if let checkoutError {
            alert = IssueInvoiceAlert(title: "無法結帳", message: checkoutError)
            return
        }
        guard let summary = checkoutSummary,
              let receivedAmount = summary.receivedAmount,
              let items = CheckoutCalculator.invoiceLines(from: orderLines, discountAmount: summary.discountAmount) else {
            alert = IssueInvoiceAlert(title: "無法結帳", message: "訂單金額計算錯誤，請重新確認。")
            return
        }

        let trimmedBuyerIdentifier = buyerIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedBuyerIdentifier.isEmpty && trimmedBuyerIdentifier.count != 8 {
            alert = IssueInvoiceAlert(title: "買方統編錯誤", message: "買方統編需為 8 位數字。")
            return
        }

        isIssuing = true
        defer { isIssuing = false }

        do {
            let invoice = try await store.issueInvoice(
                buyerIdentifier: trimmedBuyerIdentifier.isEmpty ? nil : trimmedBuyerIdentifier,
                totalAmount: summary.total,
                items: items.map { InvoiceIssueItemRequest(name: $0.name, quantity: $0.quantity, unitPrice: $0.unitPrice) },
                checkout: InvoiceCheckoutRequest(
                    subtotalAmount: summary.subtotal,
                    discountType: summary.discount?.type.rawValue,
                    discountValue: summary.discount?.value,
                    discountAmount: summary.discountAmount,
                    receivedAmount: receivedAmount,
                    changeAmount: summary.changeAmount ?? 0
                )
            )
            resetOrder()
            alert = IssueInvoiceAlert(
                title: "已開立發票",
                message: "\(invoice.invoiceNumber)\n找零 \(formatPrice(summary.changeAmount ?? 0))\n已建立待列印任務。"
            )
        } catch {
            alert = IssueInvoiceAlert(title: "開立失敗", message: error.localizedDescription)
        }
    }

    private func resetOrder() {
        quantities = [:]
        variablePriceTexts = [:]
        buyerIdentifier = ""
        discountType = nil
        discountValueText = ""
        receivedAmountText = ""
    }
}

private struct ProductQuantityRow: View {
    let product: CatalogProduct
    let quantity: Int
    @Binding var variablePriceText: String
    let priceLabel: String
    let onDecrease: () -> Void
    let onIncrease: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(product.name).font(.body.weight(.semibold))
                    Text(product.categoryName ?? "未分類").font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                Text(product.isVariablePrice ? "現場報價" : priceLabel)
                    .monospacedDigit().foregroundColor(product.isVariablePrice ? .orange : .secondary)
                StepperQuantityControl(quantity: quantity, onDecrease: onDecrease, onIncrease: onIncrease)
            }
            if product.isVariablePrice && quantity > 0 {
                TextField("現場單價", text: $variablePriceText)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct StepperQuantityControl: View {
    let quantity: Int
    let onDecrease: () -> Void
    let onIncrease: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onDecrease) { Image(systemName: "minus.circle") }.buttonStyle(.borderless).disabled(quantity == 0)
            Text("\(quantity)").frame(width: 32).monospacedDigit()
            Button(action: onIncrease) { Image(systemName: "plus.circle.fill") }.buttonStyle(.borderless)
        }
    }
}

private struct CheckoutSummaryRows: View {
    let summary: CheckoutSummary?
    let hasDiscount: Bool

    var body: some View {
        if let summary {
            CheckoutAmountRow(title: "原始總額", value: formatPrice(summary.subtotal))
            if hasDiscount {
                CheckoutAmountRow(title: "折扣", value: "-\(formatPrice(summary.discountAmount))")
            }
            CheckoutAmountRow(title: "應付金額", value: formatPrice(summary.total), emphasized: true)
            if let shortage = summary.shortageAmount {
                CheckoutAmountRow(title: "尚差", value: formatPrice(shortage), tint: .red)
            } else if let change = summary.changeAmount {
                CheckoutAmountRow(title: "找零", value: formatPrice(change), tint: .green)
            }
        }
    }
}

private struct CheckoutAmountRow: View {
    let title: String
    let value: String
    var emphasized = false
    var tint: Color = .primary

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).monospacedDigit().fontWeight(emphasized ? .semibold : .regular).foregroundColor(tint)
        }
    }
}

private struct IssueInvoiceSummaryBar: View {
    let totalQuantity: Int
    let summary: CheckoutSummary?
    let error: String?
    let isIssuing: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error, totalQuantity > 0 {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("數量 \(totalQuantity)").font(.caption).foregroundColor(.secondary)
                    Text(formatPrice(summary?.total ?? 0)).font(.title3.weight(.semibold)).monospacedDigit()
                }
                Spacer()
                Button(action: action) {
                    if isIssuing { ProgressView() } else { Label("結帳並開立", systemImage: "doc.badge.plus") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(totalQuantity == 0 || error != nil || isIssuing)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12).background(.regularMaterial)
    }
}

private struct IssueInvoiceAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private func formatPrice(_ price: Int) -> String { "$\(price)" }

private extension CatalogProduct {
    var isVariablePrice: Bool { price == 0 }
}
