import SwiftUI

struct IssueInvoiceView: View {
    @EnvironmentObject private var store: AppStore
    @State private var quantities: [Int: Int] = [:]
    @State private var buyerIdentifier = ""
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

    private var totalAmount: Int {
        selectedProducts.reduce(0) { sum, product in
            sum + product.price * quantity(for: product)
        }
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
                                Text("目前沒有可開發票的商品")
                                    .foregroundColor(.secondary)
                                Button {
                                    Task { await store.refreshCatalog() }
                                } label: {
                                    Label("重新同步", systemImage: "arrow.clockwise")
                                }
                            }
                            .padding(.vertical, 6)
                        } else {
                            ForEach(activeProducts) { product in
                                ProductQuantityRow(
                                    product: product,
                                    decimalPlaces: store.catalogPriceDecimalPlaces,
                                    quantity: quantity(for: product),
                                    onDecrease: { setQuantity(quantity(for: product) - 1, for: product) },
                                    onIncrease: { setQuantity(quantity(for: product) + 1, for: product) }
                                )
                            }
                        }
                    }
                }

                IssueInvoiceSummaryBar(
                    totalQuantity: totalQuantity,
                    totalAmount: totalAmount,
                    decimalPlaces: store.catalogPriceDecimalPlaces,
                    isIssuing: isIssuing || store.invoiceSyncStatus.isSyncing,
                    action: {
                        Task { await issueInvoice() }
                    }
                )
            }
            .navigationTitle("開發票")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await store.refreshCatalog() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(store.catalogSyncStatus.isSyncing)
                }
            }
            .task {
                if store.catalogProducts.isEmpty {
                    await store.refreshCatalog()
                }
            }
            .alert(item: $alert) { item in
                Alert(
                    title: Text(item.title),
                    message: Text(item.message),
                    dismissButton: .default(Text("好"))
                )
            }
        }
    }

    private func quantity(for product: CatalogProduct) -> Int {
        quantities[product.id] ?? 0
    }

    private func setQuantity(_ quantity: Int, for product: CatalogProduct) {
        quantities[product.id] = max(0, min(quantity, 999))
    }

    private func issueInvoice() async {
        guard totalQuantity > 0 else {
            alert = IssueInvoiceAlert(title: "尚未選商品", message: "請先選擇至少一項商品。")
            return
        }

        let trimmedBuyerIdentifier = buyerIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedBuyerIdentifier.isEmpty && trimmedBuyerIdentifier.count != 8 {
            alert = IssueInvoiceAlert(title: "買方統編錯誤", message: "買方統編需為 8 位數字。")
            return
        }

        let items = selectedProducts.map { product in
            InvoiceIssueItemRequest(
                name: product.name,
                quantity: quantity(for: product),
                unitPrice: product.price
            )
        }

        isIssuing = true
        defer { isIssuing = false }

        do {
            let invoice = try await store.issueInvoice(
                buyerIdentifier: trimmedBuyerIdentifier.isEmpty ? nil : trimmedBuyerIdentifier,
                totalAmount: totalAmount,
                items: items
            )
            quantities = [:]
            buyerIdentifier = ""
            alert = IssueInvoiceAlert(
                title: "已開立發票",
                message: "\(invoice.invoiceNumber)\n已建立待列印任務。"
            )
        } catch {
            alert = IssueInvoiceAlert(title: "開立失敗", message: error.localizedDescription)
        }
    }
}

private struct ProductQuantityRow: View {
    let product: CatalogProduct
    let decimalPlaces: Int
    let quantity: Int
    let onDecrease: () -> Void
    let onIncrease: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(.body.weight(.semibold))
                Text(product.categoryName ?? "未分類")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text(formatPrice(product.price, decimalPlaces: decimalPlaces))
                .monospacedDigit()
                .foregroundColor(.secondary)

            StepperQuantityControl(
                quantity: quantity,
                onDecrease: onDecrease,
                onIncrease: onIncrease
            )
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
            Button(action: onDecrease) {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless)
            .disabled(quantity == 0)

            Text("\(quantity)")
                .frame(width: 32)
                .monospacedDigit()

            Button(action: onIncrease) {
                Image(systemName: "plus.circle.fill")
            }
            .buttonStyle(.borderless)
        }
    }
}

private struct IssueInvoiceSummaryBar: View {
    let totalQuantity: Int
    let totalAmount: Int
    let decimalPlaces: Int
    let isIssuing: Bool
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("數量 \(totalQuantity)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatPrice(totalAmount, decimalPlaces: decimalPlaces))
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                }

                Spacer()

                Button(action: action) {
                    if isIssuing {
                        ProgressView()
                    } else {
                        Label("開立", systemImage: "doc.badge.plus")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(totalQuantity == 0 || isIssuing)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial)
    }
}

private struct IssueInvoiceAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private func formatPrice(_ price: Int, decimalPlaces: Int) -> String {
    guard decimalPlaces > 0 else {
        return "$\(price)"
    }
    let divisor = Int(pow(10.0, Double(decimalPlaces)))
    let whole = price / divisor
    let fraction = price % divisor
    return "$\(whole).\(String(format: "%0\(decimalPlaces)d", fraction))"
}
