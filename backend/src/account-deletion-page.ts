export function accountDeletionPage(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <title>OpenvoKao 帳號刪除</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f7f8; color: #18202a; line-height: 1.6; }
    header { background: #12324a; color: white; padding: 28px 20px; }
    header div, main { width: min(720px, 100%); margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: clamp(1.6rem, 5vw, 2.1rem); }
    h2 { margin: 0 0 12px; font-size: 1.2rem; }
    p { margin: 8px 0; }
    main { padding: 20px; display: grid; gap: 16px; }
    section { background: white; border: 1px solid #d8dee5; border-radius: 12px; padding: 20px; }
    ul, ol { margin: 8px 0; padding-left: 24px; }
    label { display: grid; gap: 6px; margin: 14px 0; font-weight: 600; }
    input[type="text"], input[type="password"] { width: 100%; padding: 12px; border: 1px solid #9ba7b4; border-radius: 8px; font: inherit; }
    .check { display: flex; align-items: flex-start; gap: 10px; font-weight: 400; }
    .check input { margin-top: 6px; }
    button { width: 100%; padding: 13px 16px; border: 0; border-radius: 8px; background: #b42318; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { background: #a8afb7; cursor: not-allowed; }
    .warning { border-left: 4px solid #b42318; padding-left: 12px; }
    .muted { color: #52606d; }
    #result { display: none; border-radius: 8px; padding: 12px; margin-top: 14px; }
    #result.error { display: block; color: #7a271a; background: #fee4e2; }
    #result.success { display: block; color: #05603a; background: #d1fadf; }
    footer { color: #52606d; text-align: center; padding: 4px 0 20px; font-size: .9rem; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>OpenvoKao 帳號刪除</h1>
      <p>嘉萱漢方有限公司提供</p>
    </div>
  </header>
  <main>
    <section>
      <h2>刪除前請先了解</h2>
      <p class="warning"><strong>帳號刪除後無法復原。</strong>輸入目前的 OpenvoKao 帳號與密碼，即可在本頁直接完成刪除，不需要重新安裝 App。</p>
      <ul>
        <li>老闆帳號：刪除公司、所有帳號、商品、裝置授權，以及 OpenvoKao 內的發票、列印與稽核紀錄。</li>
        <li>員工帳號：刪除姓名、電話、帳號、密碼、登入憑證及只由該帳號使用的裝置授權。</li>
        <li>員工所屬公司的商品、發票與營業紀錄屬於公司，刪除員工帳號後仍由公司保留。</li>
      </ul>
      <p class="muted">刪除 OpenvoKao 內的資料不會作廢或註銷已送出的電子發票。公司負責人請先保存依法需要留存的發票與交易資料。</p>
    </section>

    <section>
      <h2>永久刪除帳號</h2>
      <form id="deletion-form">
        <label>OpenvoKao 帳號
          <input id="account" name="account" type="text" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z][A-Za-z0-9_]{2,31}">
        </label>
        <label>目前密碼
          <input id="password" name="password" type="password" autocomplete="current-password" required minlength="6">
        </label>
        <label class="check">
          <input id="understood" type="checkbox" required>
          <span>我了解此動作無法復原，並確認要刪除帳號及上述相關資料。</span>
        </label>
        <button id="submit" type="submit">永久刪除帳號</button>
      </form>
      <div id="result" role="status" aria-live="polite"></div>
    </section>

    <section>
      <h2>App 內刪除方式</h2>
      <ol>
        <li>登入 OpenvoKao Android App。</li>
        <li>開啟「選單」→「帳號與資料」。</li>
        <li>閱讀資料範圍、輸入目前密碼並確認永久刪除。</li>
      </ol>
    </section>
    <footer>OpenvoKao · 嘉萱漢方有限公司 · 服務電話 0800-000-783</footer>
  </main>
  <script>
    const form = document.getElementById('deletion-form');
    const submit = document.getElementById('submit');
    const result = document.getElementById('result');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!window.confirm('確定要永久刪除這個帳號及相關資料？此動作無法復原。')) return;

      submit.disabled = true;
      submit.textContent = '正在刪除…';
      result.className = '';
      result.textContent = '';

      try {
        const response = await fetch('/api/account-deletion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            account: document.getElementById('account').value.trim(),
            password: document.getElementById('password').value
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '目前無法刪除帳號，請稍後重試。');

        form.reset();
        form.hidden = true;
        result.className = 'success';
        result.textContent = data.deletedScope === 'company'
          ? '公司、帳號及相關資料已永久刪除。'
          : '你的帳號及相關個人資料已永久刪除。';
      } catch (error) {
        result.className = 'error';
        result.textContent = error instanceof Error ? error.message : '目前無法刪除帳號，請稍後重試。';
      } finally {
        submit.disabled = false;
        submit.textContent = '永久刪除帳號';
      }
    });
  </script>
</body>
</html>`;
}
