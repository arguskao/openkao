import SwiftUI

struct AuthGatewayView: View {
    @EnvironmentObject private var store: AppStore
    @State private var mode: AuthMode = .login
    @State private var loginAccount = ""
    @State private var loginPassword = ""
    @State private var registerName = ""
    @State private var registerPhone = ""
    @State private var registerAccount = ""
    @State private var registerPassword = ""
    @State private var registerCompanyName = ""
    @State private var registerTaxId = ""
    @State private var registerAddress = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Picker("模式", selection: $mode) {
                        ForEach(AuthMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("裝置") {
                    TextField("裝置名稱", text: $store.deviceProfile.deviceName)
                    TextField("伺服器 URL", text: $store.deviceProfile.serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if mode == .login {
                    Section("登入") {
                        TextField("帳號", text: $loginAccount)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        SecureField("密碼", text: $loginPassword)
                    }
                } else {
                    Section("會員資料") {
                        TextField("姓名", text: $registerName)
                        TextField("手機", text: $registerPhone)
                            .keyboardType(.phonePad)
                        TextField("英文帳號", text: $registerAccount)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("密碼", text: $registerPassword)
                    }

                    Section("公司資料") {
                        TextField("公司名稱", text: $registerCompanyName)
                        TextField("統一編號", text: $registerTaxId)
                            .keyboardType(.numberPad)
                        TextField("公司地址", text: $registerAddress)
                    }
                }

                if let errorMessage {
                    Section("提示") {
                        Text(errorMessage)
                            .foregroundColor(.red)
                    }
                }

                Section {
                    Button {
                        Task {
                            await submit()
                        }
                    } label: {
                        if isSubmitting {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                        } else {
                            Text(mode.actionTitle)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .navigationTitle("登入公司")
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            switch mode {
            case .login:
                try await store.loginAccount(
                    account: loginAccount.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: loginPassword
                )
            case .register:
                try await store.registerAccount(
                    name: registerName.trimmingCharacters(in: .whitespacesAndNewlines),
                    phone: registerPhone.trimmingCharacters(in: .whitespacesAndNewlines),
                    account: registerAccount.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: registerPassword,
                    companyName: registerCompanyName.trimmingCharacters(in: .whitespacesAndNewlines),
                    taxId: registerTaxId.trimmingCharacters(in: .whitespacesAndNewlines),
                    address: registerAddress.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum AuthMode: String, CaseIterable, Identifiable {
    case login
    case register

    var id: String { rawValue }

    var title: String {
        switch self {
        case .login:
            return "登入"
        case .register:
            return "註冊"
        }
    }

    var actionTitle: String {
        switch self {
        case .login:
            return "登入"
        case .register:
            return "建立公司並註冊"
        }
    }
}

#Preview {
    AuthGatewayView()
        .environmentObject(AppStore())
}
