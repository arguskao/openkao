import SwiftUI

struct ProductCatalogView: View {
    @EnvironmentObject private var store: AppStore
    @State private var mode: CatalogMode = .products
    @State private var categoryFilter = CatalogFilter.all.rawValue
    @State private var categoryEditor: CategoryEditorState?
    @State private var productEditor: ProductEditorState?
    @State private var pendingDeleteCategory: CatalogCategory?
    @State private var pendingDeleteProduct: CatalogProduct?
    @State private var alert: CatalogAlert?
    @State private var priceDecimalPlaces = 0
    @State private var refreshTask: Task<Void, Never>?

    var body: some View {
        NavigationView {
            Group {
                if store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    catalogSetupPrompt
                } else {
                    VStack(spacing: 0) {
                        Picker("模式", selection: $mode) {
                            ForEach(CatalogMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal)
                        .padding(.top, 12)
                        .padding(.bottom, 8)

                        if let syncMessage = store.catalogSyncStatus.message {
                            Text(syncMessage)
                                .font(.footnote)
                                .foregroundColor(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal)
                                .padding(.bottom, 8)
                        }

                        if mode == .categories {
                            categoryList
                        } else {
                            productList
                        }
                    }
                }
            }
            .navigationTitle("商品")
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if !store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            startRefreshCatalog()
                        } label: {
                            if store.catalogSyncStatus.isSyncing {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                        .disabled(store.catalogSyncStatus.isSyncing)

                        Button {
                            if mode == .categories {
                                categoryEditor = CategoryEditorState.new(defaultSortOrder: nextCategorySortOrder)
                            } else {
                                productEditor = ProductEditorState.new(
                                    defaultCategoryId: defaultCategoryId,
                                    defaultSortOrder: nextProductSortOrder
                                )
                            }
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .task {
                guard !store.deviceProfile.deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                priceDecimalPlaces = store.catalogPriceDecimalPlaces
                if store.catalogCategories.isEmpty && store.catalogProducts.isEmpty {
                    await store.refreshCatalog()
                }
            }
            .onChange(of: store.catalogPriceDecimalPlaces) { newValue in
                priceDecimalPlaces = newValue
            }
            .onDisappear {
                refreshTask?.cancel()
                refreshTask = nil
            }
            .sheet(item: $categoryEditor) { editor in
                CategoryEditorSheet(editor: editor) { updated in
                    Task {
                        await saveCategory(updated)
                    }
                }
            }
            .sheet(item: $productEditor) { editor in
                ProductEditorSheet(
                    editor: editor,
                    categories: store.catalogCategories
                ) { updated in
                    Task {
                        await saveProduct(updated)
                    }
                }
            }
            .confirmationDialog(
                "確定要刪除這個分類嗎？",
                isPresented: Binding(
                    get: { pendingDeleteCategory != nil },
                    set: { if !$0 { pendingDeleteCategory = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("刪除分類", role: .destructive) {
                    guard let category = pendingDeleteCategory else { return }
                    Task {
                        await deleteCategory(category)
                    }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("刪除後，原本掛在這個分類下的商品會改成未分類。")
            }
            .confirmationDialog(
                "確定要刪除這個商品嗎？",
                isPresented: Binding(
                    get: { pendingDeleteProduct != nil },
                    set: { if !$0 { pendingDeleteProduct = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("刪除商品", role: .destructive) {
                    guard let product = pendingDeleteProduct else { return }
                    Task {
                        await deleteProduct(product)
                    }
                }
                Button("取消", role: .cancel) {}
            }
            .alert(item: $alert) { alert in
                Alert(title: Text(alert.title), message: Text(alert.message), dismissButton: .default(Text("好")))
            }
        }
    }

    private func startRefreshCatalog() {
        refreshTask?.cancel()
        refreshTask = Task {
            await store.refreshCatalog()
        }
    }

    private var catalogSetupPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "shippingbox")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("請先登入並完成裝置綁定")
                .font(.headline)
            Text("商品分類和商品管理會跟後台綁定的公司資料同步。")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var categoryList: some View {
        List {
            Section("商品分類") {
                if store.catalogCategories.isEmpty {
                    Text("尚無分類資料")
                        .foregroundColor(.secondary)
                }

                ForEach(store.catalogCategories) { category in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(category.name)
                                .font(.headline)
                            Spacer()
                            Text(category.status)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(category.status == "顯示" ? Color.green.opacity(0.18) : Color.gray.opacity(0.2))
                                .clipShape(Capsule())
                        }

                        HStack {
                            Text("排序 \(category.sortOrder)")
                            Spacer()
                            Text("\(category.productCount) 項商品")
                        }
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        categoryEditor = CategoryEditorState.editing(category)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("刪除", role: .destructive) {
                            pendingDeleteCategory = category
                        }

                        Button("編輯") {
                            categoryEditor = CategoryEditorState.editing(category)
                        }
                        .tint(.blue)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var productList: some View {
        List {
            Section("小數位數") {
                VStack(alignment: .leading, spacing: 10) {
                    Stepper("小數位數 \(priceDecimalPlaces)", value: $priceDecimalPlaces, in: 0...4)
                    Button("套用") {
                        Task {
                            await savePriceDecimalPlaces()
                        }
                    }
                }
            }

            Section("分類篩選") {
                Picker("分類", selection: $categoryFilter) {
                    Text("全部").tag(CatalogFilter.all.rawValue)
                    Text("未分類").tag(CatalogFilter.uncategorized.rawValue)
                    ForEach(store.catalogCategories) { category in
                        Text(category.name).tag(String(category.id))
                    }
                }
            }

            Section("商品管理") {
                if filteredProducts.isEmpty {
                    Text("目前沒有商品")
                        .foregroundColor(.secondary)
                }

                ForEach(filteredProducts) { product in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(product.name)
                                    .font(.headline)
                                Text(product.categoryName ?? "未分類")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            Text(catalogPriceLabel(price: product.price, decimalPlaces: store.catalogPriceDecimalPlaces))
                                .font(.headline.monospacedDigit())
                        }

                        HStack(spacing: 12) {
                            ProductMetaChip(text: product.status, tint: product.status == "顯示" ? .green : .gray)
                            ProductMetaChip(text: product.taxType, tint: .blue)
                            ProductMetaChip(text: "排序 \(product.sortOrder)", tint: .orange)
                        }

                        if let imagePath = product.imagePath, !imagePath.isEmpty {
                            Text(imagePath)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        productEditor = ProductEditorState.editing(product, decimalPlaces: store.catalogPriceDecimalPlaces)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("刪除", role: .destructive) {
                            pendingDeleteProduct = product
                        }

                        Button("編輯") {
                            productEditor = ProductEditorState.editing(product, decimalPlaces: store.catalogPriceDecimalPlaces)
                        }
                        .tint(.blue)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var filteredProducts: [CatalogProduct] {
        store.catalogProducts.filter { product in
            switch categoryFilter {
            case CatalogFilter.all.rawValue:
                return true
            case CatalogFilter.uncategorized.rawValue:
                return product.categoryId == nil
            default:
                return String(product.categoryId ?? -1) == categoryFilter
            }
        }
    }

    private var defaultCategoryId: Int? {
        store.catalogCategories.first?.id
    }

    private var nextCategorySortOrder: Int {
        (store.catalogCategories.map(\.sortOrder).max() ?? -1) + 1
    }

    private var nextProductSortOrder: Int {
        (store.catalogProducts.map(\.sortOrder).max() ?? -1) + 1
    }

    private func saveCategory(_ editor: CategoryEditorState) async {
        let trimmedName = editor.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            alert = CatalogAlert(title: "分類名稱未填", message: "請輸入商品分類名稱。")
            return
        }

        do {
            if let categoryID = editor.categoryID {
                try await store.updateCategory(id: categoryID, name: trimmedName, sortOrder: editor.sortOrder, status: editor.status)
            } else {
                try await store.createCategory(name: trimmedName, sortOrder: editor.sortOrder, status: editor.status)
            }
            categoryEditor = nil
        } catch {
            alert = CatalogAlert(title: "儲存分類失敗", message: error.localizedDescription)
        }
    }

    private func saveProduct(_ editor: ProductEditorState) async {
        let trimmedName = editor.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            alert = CatalogAlert(title: "商品名稱未填", message: "請輸入商品名稱。")
            return
        }

        guard let price = parseScaledPrice(editor.priceText, decimalPlaces: store.catalogPriceDecimalPlaces) else {
            alert = CatalogAlert(title: "價格錯誤", message: "請輸入正確的商品價格。")
            return
        }

        do {
            if let productID = editor.productID {
                try await store.updateProduct(
                    id: productID,
                    categoryId: editor.categoryID,
                    name: trimmedName,
                    price: price,
                    imagePath: editor.imagePath.nilIfBlank,
                    status: editor.status,
                    taxType: editor.taxType,
                    sortOrder: editor.sortOrder
                )
            } else {
                try await store.createProduct(
                    categoryId: editor.categoryID,
                    name: trimmedName,
                    price: price,
                    imagePath: editor.imagePath.nilIfBlank,
                    status: editor.status,
                    taxType: editor.taxType,
                    sortOrder: editor.sortOrder
                )
            }
            productEditor = nil
        } catch {
            alert = CatalogAlert(title: "儲存商品失敗", message: error.localizedDescription)
        }
    }

    private func deleteCategory(_ category: CatalogCategory) async {
        do {
            try await store.deleteCategory(id: category.id)
            pendingDeleteCategory = nil
        } catch {
            alert = CatalogAlert(title: "刪除分類失敗", message: error.localizedDescription)
        }
    }

    private func deleteProduct(_ product: CatalogProduct) async {
        do {
            try await store.deleteProduct(id: product.id)
            pendingDeleteProduct = nil
        } catch {
            alert = CatalogAlert(title: "刪除商品失敗", message: error.localizedDescription)
        }
    }

    private func savePriceDecimalPlaces() async {
        do {
            try await store.updateCatalogPriceDecimalPlaces(priceDecimalPlaces)
        } catch {
            alert = CatalogAlert(title: "儲存價格設定失敗", message: error.localizedDescription)
        }
    }
}

private enum CatalogMode: String, CaseIterable, Identifiable {
    case products
    case categories

    var id: String { rawValue }

    var title: String {
        switch self {
        case .products:
            return "商品管理"
        case .categories:
            return "商品分類"
        }
    }
}

private enum CatalogFilter: String {
    case all = "__all__"
    case uncategorized = "__uncategorized__"
}

private struct ProductMetaChip: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.16))
            .clipShape(Capsule())
    }
}

private struct CategoryEditorState: Identifiable {
    let id = UUID()
    var categoryID: Int?
    var name: String
    var sortOrder: Int
    var status: String

    static func new(defaultSortOrder: Int) -> CategoryEditorState {
        CategoryEditorState(categoryID: nil, name: "", sortOrder: defaultSortOrder, status: "顯示")
    }

    static func editing(_ category: CatalogCategory) -> CategoryEditorState {
        CategoryEditorState(
            categoryID: category.id,
            name: category.name,
            sortOrder: category.sortOrder,
            status: category.status
        )
    }
}

private struct ProductEditorState: Identifiable {
    let id = UUID()
    var productID: Int?
    var categoryID: Int?
    var name: String
    var priceText: String
    var imagePath: String
    var status: String
    var taxType: String
    var sortOrder: Int

    static func new(defaultCategoryId: Int?, defaultSortOrder: Int) -> ProductEditorState {
        ProductEditorState(
            productID: nil,
            categoryID: defaultCategoryId,
            name: "",
            priceText: "0",
            imagePath: "",
            status: "顯示",
            taxType: "含稅",
            sortOrder: defaultSortOrder
        )
    }

    static func editing(_ product: CatalogProduct, decimalPlaces: Int) -> ProductEditorState {
        ProductEditorState(
            productID: product.id,
            categoryID: product.categoryId,
            name: product.name,
            priceText: editablePriceText(price: product.price, decimalPlaces: decimalPlaces),
            imagePath: product.imagePath ?? "",
            status: product.status,
            taxType: product.taxType,
            sortOrder: product.sortOrder
        )
    }
}

private struct CategoryEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var editor: CategoryEditorState
    let onSave: (CategoryEditorState) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section("分類資料") {
                    TextField("分類名稱", text: $editor.name)
                    Stepper("排序 \(editor.sortOrder)", value: $editor.sortOrder, in: 0...999)
                    Picker("狀態", selection: $editor.status) {
                        Text("顯示").tag("顯示")
                        Text("隱藏").tag("隱藏")
                    }
                }
            }
            .navigationTitle(editor.categoryID == nil ? "新增分類" : "編輯分類")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("儲存") {
                        onSave(editor)
                    }
                }
            }
        }
    }
}

private struct ProductEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var editor: ProductEditorState
    let categories: [CatalogCategory]
    let onSave: (ProductEditorState) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section("商品資料") {
                    TextField("商品名稱", text: $editor.name)
                    TextField("價格", text: $editor.priceText)
                        .keyboardType(.decimalPad)

                    Picker("分類", selection: $editor.categoryID) {
                        Text("未分類").tag(Int?.none)
                        ForEach(categories) { category in
                            Text(category.name).tag(Int?.some(category.id))
                        }
                    }

                    TextField("圖片路徑（可留空）", text: $editor.imagePath)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Picker("狀態", selection: $editor.status) {
                        Text("顯示").tag("顯示")
                        Text("隱藏").tag("隱藏")
                    }

                    Picker("稅別", selection: $editor.taxType) {
                        Text("含稅").tag("含稅")
                        Text("未稅").tag("未稅")
                    }

                    Stepper("排序 \(editor.sortOrder)", value: $editor.sortOrder, in: 0...9999)
                }
            }
            .navigationTitle(editor.productID == nil ? "新增商品" : "編輯商品")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("儲存") {
                        onSave(editor)
                    }
                }
            }
        }
    }
}

private struct CatalogAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private func parseDecimalPlaces(_ text: String) -> Int? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let value = Int(trimmed), (0...4).contains(value) else {
        return nil
    }
    return value
}

private func parseScaledPrice(_ text: String, decimalPlaces: Int) -> Int? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count <= 2 else { return nil }

    let wholePart = String(parts[0])
    guard !wholePart.isEmpty, wholePart.allSatisfy(\.isNumber) else { return nil }

    let fractionPart = parts.count == 2 ? String(parts[1]) : ""
    guard fractionPart.allSatisfy(\.isNumber) else { return nil }
    guard fractionPart.count <= decimalPlaces else { return nil }

    let normalizedFraction = fractionPart.padding(toLength: decimalPlaces, withPad: "0", startingAt: 0)
    guard let wholeValue = Int(wholePart) else { return nil }
    let fractionValue: Int
    if normalizedFraction.isEmpty {
        fractionValue = 0
    } else {
        guard let parsedFraction = Int(normalizedFraction) else { return nil }
        fractionValue = parsedFraction
    }

    let multiplier = integerPower10(decimalPlaces)
    return wholeValue * multiplier + fractionValue
}

private func editablePriceText(price: Int, decimalPlaces: Int) -> String {
    guard decimalPlaces > 0 else { return String(price) }

    let divisor = integerPower10(decimalPlaces)
    let whole = price / divisor
    let fraction = price % divisor
    let fractionText = String(fraction).leftPadding(toLength: decimalPlaces, withPad: "0")
    return "\(whole).\(fractionText)"
}

private func catalogPriceLabel(price: Int, decimalPlaces: Int) -> String {
    "$\(editablePriceText(price: price, decimalPlaces: decimalPlaces))"
}

private func integerPower10(_ exponent: Int) -> Int {
    (0..<exponent).reduce(1) { value, _ in value * 10 }
}

private extension String {
    func leftPadding(toLength length: Int, withPad pad: String) -> String {
        guard count < length else { return self }
        return String(repeating: pad, count: length - count) + self
    }
}
