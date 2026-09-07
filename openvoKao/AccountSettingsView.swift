import SwiftUI

struct AccountSettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var confirmLogout = false

    var body: some View {
        List {
            Section("帳號資料") {
                AccountValueRow(title: "姓名", value: displayName)
                AccountValueRow(title: "帳號", value: store.authSession.account)
                if !store.authSession.phone.isEmpty {
                    AccountValueRow(title: "電話", value: store.authSession.phone)
                }
                AccountValueRow(title: "公司", value: store.authSession.companyName)
                AccountValueRow(title: "身分", value: store.isOwner ? "老闆" : "員工")
            }

            Section {
                Button {
                    confirmLogout = true
                } label: {
                    Label("登出", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }

            Section {
                NavigationLink {
                    DeleteAccountView()
                } label: {
                    Label("刪除帳號", systemImage: "person.crop.circle.badge.minus")
                        .foregroundColor(.red)
                }
            } header: {
                Text("帳號與資料")
            } footer: {
                Text("你可以在下一頁查看將刪除的資料，並直接完成帳號刪除。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("帳號設定")
        .confirmationDialog("確定要登出？", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("登出", role: .destructive) {
                Task { await store.logoutAccount() }
            }
            Button("取消", role: .cancel) {}
        }
    }

    private var displayName: String {
        let name = store.authSession.userName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "未設定" : name
    }
}

private struct DeleteAccountView: View {
    @EnvironmentObject private var store: AppStore
    @State private var password = ""
    @State private var understood = false
    @State private var confirmDeletion = false
    @State private var isDeleting = false
    @State private var alert: AccountDeletionAlert?

    var body: some View {
        Form {
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 36))
                        .foregroundColor(.red)

                    Text(store.isOwner ? "刪除公司與帳號" : "永久刪除帳號")
                        .font(.title3.weight(.semibold))

                    Text("刪除後無法復原。")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            Section("將會刪除") {
                ForEach(deletionItems, id: \.self) { item in
                    Label(item, systemImage: "minus.circle")
                }
            }

            if store.isOwner {
                Section("電子發票提醒") {
                    Text("刪除本服務中的資料不會作廢或註銷已送出的電子發票。請先確認已保存依法需要留存的資料。")
                        .foregroundColor(.secondary)
                }
            } else {
                Section("公司資料") {
                    Text("公司的商品、發票與營業紀錄屬於公司，刪除你的員工帳號後仍會由公司保留。")
                        .foregroundColor(.secondary)
                }
            }

            Section("確認身分") {
                SecureField("請輸入目前密碼", text: $password)
                    .textContentType(.password)

                Toggle("我了解此動作無法復原", isOn: $understood)
            }

            Section {
                Button(role: .destructive) {
                    confirmDeletion = true
                } label: {
                    HStack {
                        Spacer()
                        if isDeleting {
                            ProgressView()
                                .padding(.trailing, 6)
                        }
                        Text(deleteButtonTitle)
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(!canDelete)
            }
        }
        .navigationTitle("刪除帳號")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            store.isOwner ? "永久刪除公司與所有帳號？" : "永久刪除你的帳號？",
            isPresented: $confirmDeletion,
            titleVisibility: .visible
        ) {
            Button(deleteButtonTitle, role: .destructive) {
                Task { await deleteAccount() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("這項操作無法復原。")
        }
        .alert(item: $alert) { value in
            Alert(
                title: Text("刪除失敗"),
                message: Text(value.message),
                dismissButton: .default(Text("好"))
            )
        }
    }

    private var deletionItems: [String] {
        if store.isOwner {
            return [
                "你的帳號與所有員工帳號",
                "公司、商品與分類資料",
                "已綁定裝置與登入憑證",
                "本服務中的發票與列印紀錄"
            ]
        }

        return [
            "你的姓名與電話",
            "帳號、密碼與所有登入憑證",
            "只由你的帳號使用的裝置授權"
        ]
    }

    private var deleteButtonTitle: String {
        store.isOwner ? "永久刪除公司與帳號" : "永久刪除帳號"
    }

    private var canDelete: Bool {
        !isDeleting && understood && password.count >= 6
    }

    @MainActor
    private func deleteAccount() async {
        guard canDelete else { return }
        isDeleting = true
        defer { isDeleting = false }

        do {
            try await store.deleteAccount(password: password)
        } catch {
            alert = AccountDeletionAlert(message: error.localizedDescription)
        }
    }
}

private struct AccountValueRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
            Spacer()
            Text(value)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct AccountDeletionAlert: Identifiable {
    let id = UUID()
    let message: String
}
