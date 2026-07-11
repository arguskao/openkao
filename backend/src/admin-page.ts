export function adminPage(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenvoKao 後台</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f8; color: #1f2933; }
    header { background: #111827; color: white; padding: 18px 20px; }
    main { max-width: 1080px; margin: 0 auto; padding: 20px; display: grid; gap: 16px; }
    section { background: white; border: 1px solid #dde2e7; border-radius: 8px; padding: 16px; }
    h1 { margin: 0; font-size: 22px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    label { display: grid; gap: 6px; margin: 10px 0; font-size: 14px; }
    input, textarea { font: inherit; padding: 10px; border: 1px solid #c9d1d9; border-radius: 6px; }
    button { font: inherit; padding: 10px 12px; border: 0; border-radius: 6px; background: #2563eb; color: white; cursor: pointer; }
    button.secondary { background: #4b5563; }
    pre { overflow: auto; background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; min-height: 80px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  </style>
</head>
<body>
  <header><h1>OpenvoKao 後台</h1></header>
  <main>
    <section>
      <h2>連線設定</h2>
      <label>Admin Token <input id="token" type="password" autocomplete="off"></label>
      <button class="secondary" onclick="loadSummary()">讀取狀態</button>
    </section>

    <section>
      <h2>建立公司</h2>
      <div class="grid">
        <label>公司名稱 <input id="companyName" value="OpenvoKao 測試店"></label>
        <label>統編 <input id="taxId" value="12345678"></label>
      </div>
      <button onclick="createCompany()">建立公司</button>
    </section>

    <section>
      <h2>註冊 iPhone 裝置</h2>
      <div class="grid">
        <label>Company ID <input id="deviceCompanyId"></label>
        <label>裝置名稱 <input id="deviceName" value="13pro"></label>
      </div>
      <button onclick="registerDevice()">註冊裝置</button>
    </section>

    <section>
      <h2>帳號管理</h2>
      <div class="grid">
        <label>Company ID <input id="userCompanyId" placeholder="可留空，列出全部"></label>
        <label>使用者 ID <input id="resetUserId" placeholder="例如 1"></label>
        <label>臨時密碼 <input id="temporaryPassword" value="abc12345"></label>
      </div>
      <div class="grid">
        <button class="secondary" onclick="loadUsers()">讀取帳號</button>
        <button onclick="resetUserPassword()">重設密碼</button>
      </div>
      <pre id="usersOutput">尚未讀取帳號</pre>
    </section>

    <section>
      <h2>建立測試列印任務</h2>
      <div class="grid">
        <label>Company ID <input id="jobCompanyId"></label>
        <label>Device ID <input id="jobDeviceId" placeholder="可留空，所有裝置可讀"></label>
        <label>發票號碼 <input id="invoiceNumber" value="AB12345678"></label>
        <label>隨機碼 <input id="randomNumber" value="5678"></label>
        <label>總金額 <input id="totalAmount" type="number" value="150"></label>
        <label>賣方統編 <input id="sellerIdentifier" value="12345678"></label>
      </div>
      <button onclick="createPrintJob()">建立列印任務</button>
    </section>

    <section>
      <h2>結果</h2>
      <pre id="output">尚未操作</pre>
    </section>
  </main>
  <script>
    const output = document.getElementById('output');
    const usersOutput = document.getElementById('usersOutput');
    const tokenInput = document.getElementById('token');
    const headers = () => ({
      'content-type': 'application/json',
      'authorization': 'Bearer ' + tokenInput.value
    });
    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const data = await response.json();
      output.textContent = JSON.stringify(data, null, 2);
      return data;
    }
    async function loadSummary() {
      await api('/api/admin/summary');
    }
    async function createCompany() {
      const data = await api('/api/admin/companies', {
        method: 'POST',
        body: JSON.stringify({ name: companyName.value, taxId: taxId.value })
      });
      if (data.id) {
        deviceCompanyId.value = data.id;
        jobCompanyId.value = data.id;
      }
    }
    async function registerDevice() {
      const data = await api('/api/devices/register', {
        method: 'POST',
        body: JSON.stringify({ companyId: deviceCompanyId.value, name: deviceName.value, platform: 'ios' })
      });
      if (data.id) jobDeviceId.value = data.id;
    }
    async function loadUsers() {
      const companyId = userCompanyId.value.trim();
      const path = companyId ? '/api/admin/users?companyId=' + encodeURIComponent(companyId) : '/api/admin/users';
      const data = await api(path);
      usersOutput.textContent = JSON.stringify(data, null, 2);
      if (data.users && data.users.length && !resetUserId.value) {
        resetUserId.value = data.users[0].id;
      }
    }
    async function resetUserPassword() {
      const userId = resetUserId.value.trim();
      const password = temporaryPassword.value;
      if (!userId || !password) {
        output.textContent = '請先輸入使用者 ID 和臨時密碼';
        return;
      }
      await api('/api/admin/users/' + encodeURIComponent(userId) + '/reset-password', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
    }
    async function createPrintJob() {
      await api('/api/admin/print-jobs', {
        method: 'POST',
        body: JSON.stringify({
          companyId: jobCompanyId.value,
          deviceId: jobDeviceId.value || undefined,
          invoiceNumber: invoiceNumber.value,
          randomNumber: randomNumber.value,
          sellerName: 'OpenvoKao 測試店',
          sellerIdentifier: sellerIdentifier.value,
          totalAmount: Number(totalAmount.value),
          items: [
            { name: '一般商品', quantity: 1, unitPrice: 100 },
            { name: '服務費', quantity: 1, unitPrice: 50 }
          ],
          qrCodePayload: invoiceNumber.value + randomNumber.value,
          barcodePayload: invoiceNumber.value
        })
      });
    }
  </script>
</body>
</html>`;
}
