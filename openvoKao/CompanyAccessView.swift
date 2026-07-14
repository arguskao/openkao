import SwiftUI

struct CompanyAccessView: View {
    @EnvironmentObject private var store: AppStore
    @State private var mode: AccessMode = .staff
    @State private var members: [StaffMember] = []
    @State private var devices: [ManagedCompanyDevice] = []
    @State private var deviceLimit = 1
    @State private var deviceUsed = 0
    @State private var isLoading = false
    @State private var memberEditor: StaffEditorState?
    @State private var pendingDeleteMember: StaffMember?
    @State private var unbindDevice: ManagedCompanyDevice?
    @State private var alert: AccessAlert?

    var body: some View {
        VStack(spacing: 0) {
            Picker("管理項目", selection: $mode) {
                ForEach(AccessMode.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 12)

            if isLoading && members.isEmpty && devices.isEmpty {
                Spacer()
                ProgressView()
                Spacer()
            } else if mode == .staff {
                staffList
            } else {
                deviceList
            }
        }
        .navigationTitle("員工與手機")
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    Task { await reload() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading)
                .accessibilityLabel("重新整理")

                if mode == .staff {
                    Button {
                        memberEditor = .new
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .accessibilityLabel("新增員工")
                }
            }
        }
        .task {
            guard store.isOwner else { return }
            await reload()
        }
        .sheet(item: $memberEditor) { editor in
            StaffEditorSheet(editor: editor) { input in
                try await saveMember(editor: editor, input: input)
            }
        }
        .sheet(item: $unbindDevice) { device in
            DeviceUnbindSheet(device: device) { code in
                try await removeDevice(device, code: code)
            }
        }
        .confirmationDialog(
            "刪除員工帳號？",
            isPresented: Binding(
                get: { pendingDeleteMember != nil },
                set: { if !$0 { pendingDeleteMember = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("刪除員工", role: .destructive) {
                guard let member = pendingDeleteMember else { return }
                Task { await deleteMember(member) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("帳號會立即停用並登出，歷史發票與操作紀錄仍會保留。")
        }
        .alert(item: $alert) { value in
            Alert(title: Text(value.title), message: Text(value.message), dismissButton: .default(Text("好")))
        }
    }

    private var staffList: some View {
        List {
            Section("員工帳號") {
                if members.isEmpty {
                    Text("尚無員工帳號")
                        .foregroundColor(.secondary)
                }

                ForEach(members) { member in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(member.name.isEmpty ? member.account : member.name)
                                .font(.headline)
                            Spacer()
                            Text(member.isActive ? "使用中" : "已停用")
                                .font(.caption)
                                .foregroundColor(member.isActive ? .green : .secondary)
                        }
                        Text(member.account)
                            .font(.subheadline.monospaced())
                        if let phone = member.phone, !phone.isEmpty {
                            Text(phone)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
                    .contentShape(Rectangle())
                    .opacity(member.isActive ? 1 : 0.65)
                    .onTapGesture {
                        memberEditor = .editing(member)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if member.isActive {
                            Button("刪除", role: .destructive) {
                                pendingDeleteMember = member
                            }
                        } else {
                            Button("恢復") {
                                Task { await restoreMember(member) }
                            }
                            .tint(.green)
                        }

                        Button("編輯") {
                            memberEditor = .editing(member)
                        }
                        .tint(.blue)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
    }

    private var deviceList: some View {
        List {
            Section("手機配額") {
                HStack {
                    Text("已綁定")
                    Spacer()
                    Text("\(deviceUsed) / \(deviceLimit) 支")
                        .font(.headline.monospacedDigit())
                }
            }

            Section("已連接手機") {
                if devices.isEmpty {
                    Text("尚無裝置")
                        .foregroundColor(.secondary)
                }

                ForEach(devices) { device in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(device.name)
                                .font(.headline)
                            if device.id == store.deviceProfile.backendDeviceId {
                                Text("此手機")
                                    .font(.caption)
                                    .foregroundColor(.accentColor)
                            }
                            Spacer()
                        }
                        Text(device.installationId == nil ? "尚未綁定" : device.platform.uppercased())
                            .font(.caption)
                            .foregroundColor(.secondary)
                        if let lastSeen = device.lastSeenAt, !lastSeen.isEmpty {
                            Text("最後連線：\(lastSeen)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 3)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("解除", role: .destructive) {
                            unbindDevice = device
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await reload() }
    }

    private func reload() async {
        guard store.isOwner, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            async let fetchedMembers = store.fetchStaffMembers()
            async let fetchedDevices = store.fetchManagedDevices()
            let (nextMembers, nextDevices) = try await (fetchedMembers, fetchedDevices)
            members = nextMembers
            devices = nextDevices.devices
            deviceLimit = nextDevices.deviceLimit
            deviceUsed = nextDevices.deviceUsed
        } catch {
            alert = AccessAlert(title: "讀取失敗", message: error.localizedDescription)
        }
    }

    private func saveMember(editor: StaffEditorState, input: StaffEditorInput) async throws {
        if let member = editor.member {
            _ = try await store.updateStaffMember(
                id: member.id,
                name: input.name,
                phone: input.phone,
                isActive: member.isActive
            )
            if !input.password.isEmpty {
                try await store.resetStaffPassword(id: member.id, password: input.password)
            }
        } else {
            _ = try await store.createStaffMember(
                account: input.account,
                password: input.password,
                name: input.name,
                phone: input.phone
            )
        }
        await reload()
    }

    private func deleteMember(_ member: StaffMember) async {
        pendingDeleteMember = nil
        do {
            try await store.deleteStaffMember(id: member.id)
            await reload()
        } catch {
            alert = AccessAlert(title: "刪除失敗", message: error.localizedDescription)
        }
    }

    private func restoreMember(_ member: StaffMember) async {
        do {
            _ = try await store.updateStaffMember(
                id: member.id,
                name: member.name,
                phone: member.phone ?? "",
                isActive: true
            )
            await reload()
        } catch {
            alert = AccessAlert(title: "恢復失敗", message: error.localizedDescription)
        }
    }

    private func removeDevice(_ device: ManagedCompanyDevice, code: String) async throws {
        try await store.revokeManagedDevice(id: device.id, unbindCode: code)
        if store.isAuthenticated {
            await reload()
        }
    }
}

private enum AccessMode: String, CaseIterable, Identifiable {
    case staff
    case devices

    var id: String { rawValue }
    var title: String { self == .staff ? "員工" : "手機" }
}

private struct StaffEditorState: Identifiable {
    let id = UUID()
    let member: StaffMember?

    static let new = StaffEditorState(member: nil)
    static func editing(_ member: StaffMember) -> StaffEditorState { StaffEditorState(member: member) }
}

private struct StaffEditorInput {
    let account: String
    let name: String
    let phone: String
    let password: String
}

private struct StaffEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let editor: StaffEditorState
    let onSave: (StaffEditorInput) async throws -> Void
    @State private var account: String
    @State private var name: String
    @State private var phone: String
    @State private var password = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(editor: StaffEditorState, onSave: @escaping (StaffEditorInput) async throws -> Void) {
        self.editor = editor
        self.onSave = onSave
        _account = State(initialValue: editor.member?.account ?? "")
        _name = State(initialValue: editor.member?.name ?? "")
        _phone = State(initialValue: editor.member?.phone ?? "")
    }

    var body: some View {
        NavigationView {
            Form {
                Section("員工資料") {
                    TextField("英文帳號", text: $account)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(editor.member != nil)
                    TextField("姓名", text: $name)
                    TextField("電話", text: $phone)
                        .keyboardType(.phonePad)
                    SecureField(editor.member == nil ? "臨時密碼" : "新臨時密碼（不修改可留空）", text: $password)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle(editor.member == nil ? "新增員工" : "編輯員工")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("儲存") {
                        Task { await save() }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func save() async {
        let input = StaffEditorInput(
            account: account.trimmingCharacters(in: .whitespacesAndNewlines),
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            phone: phone.trimmingCharacters(in: .whitespacesAndNewlines),
            password: password
        )
        guard !input.name.isEmpty, editor.member != nil || (!input.account.isEmpty && !input.password.isEmpty) else {
            errorMessage = "請填寫必要資料。"
            return
        }

        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await onSave(input)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DeviceUnbindSheet: View {
    @Environment(\.dismiss) private var dismiss
    let device: ManagedCompanyDevice
    let onConfirm: (String) async throws -> Void
    @State private var code = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            Form {
                Section("解除手機") {
                    Text(device.name)
                    SecureField("8 位數解除碼", text: $code)
                        .keyboardType(.numberPad)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("解除綁定")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("解除", role: .destructive) {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting || code.count != 8)
                }
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await onConfirm(code)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AccessAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}
