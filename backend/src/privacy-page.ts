export function privacyPage(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <meta name="description" content="OpenvoKao Android App 隱私權政策、資料保存與刪除方式，以及 Google Play Data safety 公開摘要。">
  <link rel="canonical" href="https://openvokao-backend.arguskao.workers.dev/privacy">
  <title>OpenvoKao 隱私權政策與 Data safety</title>
  <style>
    :root {
      color-scheme: light;
      --navy: #0c3145;
      --navy-light: #174e68;
      --teal: #137c7b;
      --teal-soft: #dff3ef;
      --ink: #162735;
      --muted: #526875;
      --line: #d9e2e7;
      --surface: #ffffff;
      --background: #f7f9fb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; scroll-padding-top: 88px; }
    body { margin: 0; background: var(--background); color: var(--ink); font-size: 16px; line-height: 1.75; }
    a { color: inherit; text-decoration: none; }
    a:focus-visible, button:focus-visible { outline: 3px solid rgba(19, 124, 123, .35); outline-offset: 3px; }
    .site-header {
      position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between;
      min-height: 72px; padding: 12px max(24px, calc((100vw - 1160px) / 2));
      border-bottom: 1px solid rgba(217, 226, 231, .9); background: rgba(255, 255, 255, .94); backdrop-filter: blur(16px);
    }
    .brand { display: flex; align-items: center; gap: 12px; line-height: 1.25; }
    .brand-mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px 5px; background: var(--navy); color: white; font-weight: 800; }
    .brand span:last-child { display: grid; }
    .brand strong { font-size: 15px; }
    .brand small { color: var(--muted); font-size: 12px; }
    nav { display: flex; align-items: center; gap: 6px; }
    nav a { padding: 8px 11px; border-radius: 10px; color: var(--muted); font-size: 14px; font-weight: 650; }
    nav a:hover { background: #eaf0f3; color: var(--navy); }
    nav .action { margin-left: 4px; background: var(--navy); color: white; }
    nav .action:hover { background: var(--navy-light); color: white; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr); gap: 58px; width: min(1160px, calc(100% - 48px)); margin: 0 auto; padding: 96px 0 82px; }
    .eyebrow { margin: 0 0 15px; color: var(--teal); font-size: 12px; font-weight: 780; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 760px; margin: 0; color: var(--navy); font-size: clamp(2.55rem, 6vw, 5rem); letter-spacing: -.055em; line-height: 1.04; }
    .lead { max-width: 700px; margin: 26px 0 0; color: #465e6d; font-size: clamp(1.07rem, 2vw, 1.25rem); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 22px; color: var(--muted); font-size: 14px; }
    .meta span::before { display: inline-block; width: 5px; height: 5px; margin: 0 8px 2px 0; border-radius: 50%; background: var(--teal); content: ""; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
    .button { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; padding: 10px 18px; border-radius: 12px; font-weight: 720; }
    .button.primary { background: var(--navy); color: white; box-shadow: 0 12px 28px rgba(12, 49, 69, .16); }
    .button.secondary { border: 1px solid var(--line); background: white; color: var(--navy); }
    .trust { align-self: center; padding: 30px; border: 1px solid rgba(19, 124, 123, .2); border-radius: 24px 8px; background: linear-gradient(150deg, #fff, #f1f9f7); box-shadow: 0 24px 80px rgba(12, 49, 69, .1); }
    .trust-badge { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 24px; border-radius: 16px; background: var(--teal-soft); color: var(--teal); font-size: 25px; }
    .trust h2 { margin: 0; color: var(--navy); font-size: 23px; line-height: 1.4; }
    .trust ul { display: grid; gap: 9px; margin: 20px 0 0; padding: 0; color: #465e6d; font-size: 15px; list-style: none; }
    .trust li::before { margin-right: 10px; color: var(--teal); content: "✓"; font-weight: 800; }
    .layout { display: grid; grid-template-columns: 220px minmax(0, 850px); gap: 62px; width: min(1160px, calc(100% - 48px)); margin: 0 auto; padding: 34px 0 96px; }
    .toc { position: sticky; top: 100px; display: grid; align-self: start; gap: 3px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: rgba(255, 255, 255, .8); }
    .toc strong { margin-bottom: 8px; color: var(--navy); font-size: 13px; }
    .toc a { padding: 6px 9px; border-radius: 8px; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .toc a:hover { background: var(--teal-soft); color: var(--navy); }
    article { min-width: 0; }
    section.policy { padding: 68px 0; border-top: 1px solid var(--line); }
    section.policy:first-child { padding-top: 0; border-top: 0; }
    .section-label { margin: 0 0 12px; color: var(--teal); font-size: 12px; font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }
    h2 { margin: 0 0 26px; color: var(--navy); font-size: clamp(1.72rem, 4vw, 2.35rem); letter-spacing: -.035em; line-height: 1.25; }
    h3 { margin: 0 0 7px; color: var(--navy); font-size: 16px; line-height: 1.45; }
    p { margin: 0 0 18px; color: #465e6d; }
    .intro { max-width: 720px; margin-top: -15px; color: var(--muted); }
    .facts, .cards, .retention, .security { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 28px; }
    .facts { gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--line); }
    .facts div, .card, .retention div, .security div { padding: 21px; background: var(--surface); }
    .facts span { display: block; color: var(--teal); font-size: 12px; font-weight: 750; }
    .facts strong { display: block; margin-top: 3px; color: var(--navy); font-size: 15px; line-height: 1.55; }
    .card, .retention div, .security div { border: 1px solid var(--line); border-radius: 16px; }
    .icon { display: grid; width: 34px; height: 34px; place-items: center; margin-bottom: 13px; border-radius: 10px; background: var(--teal-soft); color: var(--teal); font-size: 17px; }
    .card p, .retention p, .security p { margin: 0; color: var(--muted); font-size: 14px; }
    .notice { margin-top: 18px; padding: 18px 20px; border-left: 4px solid var(--teal); border-radius: 0 12px 12px 0; background: var(--teal-soft); color: #365f65; font-size: 14px; }
    .purpose { margin: 0 0 28px; padding: 0; border-top: 1px solid var(--line); list-style: none; counter-reset: purpose; }
    .purpose li { display: grid; grid-template-columns: 45px 1fr; padding: 16px 0; border-bottom: 1px solid var(--line); counter-increment: purpose; }
    .purpose li::before { color: var(--teal); content: "0" counter(purpose); font-size: 12px; font-weight: 750; }
    .purpose p { margin: 0; }
    .deletion { display: grid; grid-template-columns: auto 1fr auto; gap: 15px; align-items: center; margin-top: 26px; padding: 21px; border: 1px solid #efc5c0; border-radius: 16px; background: #fff9f8; color: #7d2921; }
    .deletion span { display: grid; }
    .deletion small { color: #87524c; }
    .provider-table, .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 16px; background: white; }
    .provider-row { display: grid; grid-template-columns: minmax(180px, .35fr) 1fr; border-top: 1px solid var(--line); }
    .provider-row:first-child { border-top: 0; background: #edf3f5; color: var(--navy); font-size: 13px; font-weight: 750; }
    .provider-row > * { padding: 15px 18px; }
    .provider-row span { color: var(--muted); }
    .badges { display: flex; flex-wrap: wrap; gap: 9px; margin: 0 0 20px; }
    .badges span { padding: 7px 11px; border-radius: 999px; background: var(--teal-soft); color: #205d5d; font-size: 13px; font-weight: 700; }
    table { width: 100%; min-width: 790px; border-collapse: collapse; text-align: left; }
    th, td { padding: 14px 15px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 13px; }
    thead th { background: #edf3f5; color: var(--navy); }
    tbody th { color: var(--navy); }
    tbody td { color: var(--muted); }
    tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
    .rights { padding-left: 22px; color: #465e6d; }
    .contact { display: grid; grid-template-columns: 1fr auto; gap: 28px; align-items: end; padding: 42px; border-radius: 24px 8px; background: var(--navy); color: white; }
    .contact h2, .contact p { color: white; }
    .contact h2 { margin-bottom: 10px; }
    .contact-links { display: grid; gap: 9px; }
    .contact-links a { padding: 10px 14px; border: 1px solid rgba(255,255,255,.3); border-radius: 10px; font-size: 14px; }
    footer { display: flex; justify-content: space-between; gap: 20px; padding: 28px max(24px, calc((100vw - 1160px) / 2)); border-top: 1px solid var(--line); background: white; color: var(--muted); font-size: 13px; }
    footer strong { color: var(--navy); }
    @media (max-width: 860px) {
      .site-header nav a:not(.action) { display: none; }
      .hero { grid-template-columns: 1fr; gap: 34px; padding: 68px 0 56px; }
      .layout { display: block; }
      .toc { position: static; grid-template-columns: repeat(2, 1fr); margin-bottom: 44px; }
      .toc strong { grid-column: 1 / -1; }
      .contact { grid-template-columns: 1fr; }
    }
    @media (max-width: 580px) {
      .site-header { padding: 10px 16px; }
      .brand small { display: none; }
      .hero, .layout { width: min(100% - 32px, 1160px); }
      h1 { font-size: 2.55rem; }
      .facts, .cards, .retention, .security { grid-template-columns: 1fr; }
      .provider-row { grid-template-columns: 1fr; }
      .provider-row > * { padding-bottom: 7px; }
      .provider-row span { padding-top: 0; padding-bottom: 15px; }
      .provider-row:first-child { display: none; }
      .deletion { grid-template-columns: 1fr; }
      .contact { padding: 28px 22px; }
      footer { display: grid; }
    }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="#top" aria-label="OpenvoKao 隱私權政策首頁">
      <span class="brand-mark" aria-hidden="true">O</span>
      <span><strong>OpenvoKao</strong><small>Android 電子發票與列印</small></span>
    </a>
    <nav aria-label="主要導覽">
      <a href="#policy">隱私權政策</a>
      <a href="#data-safety">Data safety</a>
      <a class="action" href="/account-deletion">刪除帳號</a>
    </nav>
  </header>

  <main id="top">
    <div class="hero">
      <div>
        <p class="eyebrow">Privacy policy · Data safety</p>
        <h1>OpenvoKao 隱私權政策</h1>
        <p class="lead">本政策說明 OpenvoKao Android App 如何蒐集、使用、保存、傳輸與刪除資料，並提供 Google Play Data safety 的公開摘要。</p>
        <div class="meta"><span>最後更新：2026 年 9 月 10 日</span><span>資料管理者：嘉萱漢方有限公司</span></div>
        <div class="hero-actions"><a class="button primary" href="#policy">閱讀完整政策</a><a class="button secondary" href="/account-deletion">帳號與資料刪除 ↗</a></div>
      </div>
      <aside class="trust" aria-label="資料承諾摘要">
        <div class="trust-badge" aria-hidden="true">✓</div>
        <p class="eyebrow">資料承諾</p>
        <h2>只為提供服務所需而處理</h2>
        <ul><li>不刊登廣告，不出售個人資料</li><li>未整合廣告追蹤或第三方分析 SDK</li><li>對外傳輸使用 HTTPS 加密</li><li>提供 App 內與網頁帳號刪除</li></ul>
      </aside>
    </div>

    <div class="layout" id="policy">
      <aside class="toc" aria-label="本頁目錄">
        <strong>本頁內容</strong>
        <a href="#scope">適用範圍</a><a href="#data">處理的資料</a><a href="#purpose">使用目的與方式</a><a href="#retention">保存與刪除</a><a href="#providers">服務供應商</a><a href="#data-safety">Data safety 摘要</a><a href="#rights">你的權利</a><a href="#security">安全措施</a><a href="#contact">聯絡方式</a>
      </aside>

      <article>
        <section class="policy" id="scope">
          <p class="section-label">01 · Scope</p><h2>適用範圍與資料管理者</h2>
          <p>本政策適用於「OpenvoKao」Android App、其共用後端服務及公開帳號刪除頁。服務由<strong>嘉萱漢方有限公司</strong>提供；在適用法律下，本公司是本政策所述個人資料的蒐集與管理者。</p>
          <div class="facts"><div><span>利用地區</span><strong>臺灣及服務供應商基礎設施所在地</strong></div><div><span>利用對象</span><strong>本公司、授權人員與必要服務供應商</strong></div><div><span>利用方式</span><strong>自動化系統處理及必要的人工作業</strong></div><div><span>服務對象</span><strong>使用 App 的公司負責人與授權員工</strong></div></div>
        </section>

        <section class="policy" id="data">
          <p class="section-label">02 · Data</p><h2>我們處理哪些資料</h2>
          <p class="intro">我們依使用者啟用的功能處理下列資料，不使用廣告 ID、IMEI，也不以 App 蒐集定位資訊。</p>
          <div class="cards">
            <div class="card"><span class="icon" aria-hidden="true">人</span><h3>帳號與人員資料</h3><p>姓名、手機號碼、登入帳號、密碼雜湊、身分角色，以及登入與裝置授權憑證。密碼原文不會儲存在 App 或後端資料庫。</p></div>
            <div class="card"><span class="icon" aria-hidden="true">司</span><h3>公司與商品資料</h3><p>公司名稱、統一編號、地址、電子發票設定、商品與分類名稱、價格、稅別、排序及啟用狀態。</p></div>
            <div class="card"><span class="icon" aria-hidden="true">票</span><h3>交易與電子發票資料</h3><p>訂單與發票號碼、開立時間、買方統一編號（如有）、品項、數量、單價、折扣、總額、實收與找零、載具／捐贈碼（如有）、作廢、補印與列印狀態。</p></div>
            <div class="card"><span class="icon" aria-hidden="true">機</span><h3>裝置與安全紀錄</h3><p>App 隨機產生的 installation UUID、裝置名稱、平台、綁定狀態、最後連線時間，以及登入、權限、列印與重要操作的稽核紀錄。App 不使用廣告 ID、IMEI 或其他硬體序號。</p></div>
            <div class="card"><span class="icon" aria-hidden="true">藍</span><h3>附近印表機資料</h3><p>掃描期間處理藍牙印表機名稱、位址與訊號強度；選定印表機的名稱與位址會留在裝置上方便重連，不會上傳至 OpenvoKao 後端。</p></div>
          </div>
          <p class="notice"><strong>位置權限說明：</strong>Android 11 以下版本可能要求位置權限才能掃描 BLE 裝置。OpenvoKao 僅用該權限搜尋附近印表機，不讀取、保存或上傳裝置位置。</p>
        </section>

        <section class="policy" id="purpose">
          <p class="section-label">03 · Purpose</p><h2>資料使用目的與蒐集依據</h2>
          <ol class="purpose"><li><p>建立與驗證帳號、執行角色權限及公司裝置綁定。</p></li><li><p>維護商品目錄，完成結帳、電子發票開立、查詢、補印、作廢與銷售報表。</p></li><li><p>將列印工作交付已授權裝置，連接使用者選定的藍牙熱感印表機。</p></li><li><p>偵測異常登入、限制濫用、維護服務安全、追查操作與處理客服問題。</p></li><li><p>履行電子發票、會計、稅務及其他依法應負的義務。</p></li></ol>
          <p>我們基於提供使用者所要求的服務、履行與使用者間的服務關係、保護服務與帳號安全，以及遵守法令義務而處理資料。依法需取得同意的情形，我們會另行告知並取得同意。</p>
          <p class="notice"><strong>不提供資料的影響：</strong>你可以選擇不提供個人資料；但未提供註冊必填資料時無法建立帳號，未提供公司及交易必填資料時無法開立電子發票，未授予藍牙權限時仍可使用其他功能，但無法搜尋或連接 BLE 印表機。</p>
        </section>

        <section class="policy" id="retention">
          <p class="section-label">04 · Retention</p><h2>資料保存期間與刪除方式</h2>
          <p class="intro">我們不會無限期保留所有資料；保存期間依資料用途、帳號狀態及法定義務決定。</p>
          <div class="retention">
            <div><h3>帳號、公司、商品與營業資料</h3><p>原則上保存至公司 Owner 完成帳號刪除。Owner 刪除時，OpenvoKao 後端會刪除公司工作區、帳號、裝置授權、商品、發票、列印及稽核資料。</p></div>
            <div><h3>員工帳號</h3><p>Staff 刪除帳號時，會刪除其姓名、電話、登入資料及專用裝置授權；公司所屬商品、發票與營業紀錄仍由公司保留，直到 Owner 刪除公司工作區或依法另行處理。</p></div>
            <div><h3>登入憑證與本機快取</h3><p>後端登入工作階段最長 30 天；登出、刪除帳號或到期時即失效。App 登出會清除登入憑證、帳號快取、商品快取與待回報列印工作。</p></div>
            <div><h3>印表機偏好</h3><p>選定印表機的名稱與位址保留在裝置上，直到使用者改選、清除 App 資料或解除安裝；登出不會自動清除此偏好。</p></div>
            <div><h3>已送出的電子發票</h3><p>刪除 OpenvoKao 帳號不會作廢、註銷或刪除已送交電子發票服務商及主管機關的發票資料；該等資料由相關單位依電子發票、會計及稅務法令另行保存。</p></div>
          </div>
          <p class="notice">為維護網路與服務安全，Cloudflare 等基礎設施可能依其服務設定短期保存請求與安全紀錄；經去識別化或依法必須保存的資料，可能在帳號刪除後保留至必要期間屆滿。</p>
          <a class="deletion" href="/account-deletion"><strong aria-hidden="true">刪</strong><span><strong>申請永久刪除帳號與資料</strong><small>可由 App「選單 → 帳號與資料」操作，或使用公開自助刪除頁。</small></span><strong aria-hidden="true">↗</strong></a>
        </section>

        <section class="policy" id="providers">
          <p class="section-label">05 · Providers</p><h2>資料接收者與服務供應商</h2>
          <p>我們不出售個人資料，也不為廣告或跨服務追蹤而分享資料。以下對象只在提供服務或履行法令所需範圍內處理資料。</p>
          <div class="provider-table" aria-label="服務供應商與資料用途">
            <div class="provider-row"><strong>對象</strong><strong>處理內容與目的</strong></div>
            <div class="provider-row"><strong>Cloudflare</strong><span>託管 HTTPS API、D1 資料庫、網路防護與必要維運紀錄；資料可能在其全球基礎設施處理。</span></div>
            <div class="provider-row"><strong>光貿科技（Amego）</strong><span>接收開立、查詢、補印、作廢電子發票所需的公司、買方（如有）、品項、金額與發票資料。</span></div>
            <div class="provider-row"><strong>財政部電子發票平台及依法有權機關</strong><span>依法接收、管理或查驗電子發票資料。</span></div>
            <div class="provider-row"><strong>使用者選定的 BLE 印表機</strong><span>App 在裝置端直接傳送收據／發票列印內容，不經 OpenvoKao 後端轉送至印表機。</span></div>
          </div>
        </section>

        <section class="policy" id="data-safety">
          <p class="section-label">06 · Google Play</p><h2>Data safety 公開摘要</h2>
          <p>下表以 Google Play 的資料類別說明目前 Android 正式版行為；「蒐集」指資料離開裝置並傳送至本公司或服務供應商。</p>
          <div class="badges"><span>✓ 傳輸中加密</span><span>✓ 可申請刪除</span><span>✓ 不供廣告使用</span></div>
          <div class="table-wrap"><table><thead><tr><th>Google Play 類別</th><th>資料</th><th>蒐集</th><th>必要性</th><th>用途</th></tr></thead><tbody>
            <tr><th>個人資訊</th><td>姓名、手機、公司地址、使用者 ID／登入帳號</td><td>是</td><td>建立帳號與提供服務所必需</td><td>帳戶管理、身分驗證、權限與客服</td></tr>
            <tr><th>財務資訊／購買記錄</th><td>交易、電子發票、商品、數量、金額與付款結算資訊</td><td>是</td><td>使用結帳或發票功能時必需</td><td>App 核心功能、報表、列印與依法開立發票</td></tr>
            <tr><th>App 活動</th><td>登入、帳號管理、裝置、發票、列印與安全稽核事件</td><td>是</td><td>使用服務時自動產生</td><td>安全防護、防詐、錯誤處理與服務維運</td></tr>
            <tr><th>裝置或其他 ID</th><td>App 隨機 installation UUID 與後端裝置 ID</td><td>是</td><td>登入與裝置綁定所必需</td><td>裝置驗證、安全與列印工作派送</td></tr>
            <tr><th>位置</th><td>精確位置或概略位置</td><td>否</td><td>不適用</td><td>舊版 Android 的位置權限僅為 BLE 掃描系統要求，不讀取、保存或上傳位置</td></tr>
            <tr><th>附近裝置</th><td>BLE 印表機名稱、位址與訊號</td><td>否（僅裝置端處理）</td><td>只有使用藍牙列印時需要</td><td>搜尋、連線與重新連接印表機</td></tr>
          </tbody></table></div>
          <p class="notice"><strong>關於「分享」的申報：</strong>資料會在提供電子發票及後端服務所必要的範圍內交由上述服務供應商處理，並可能依法提供主管機關。Play Console 是否勾選「分享」應依 Google 對服務供應商與法定移轉的定義，以及實際合約關係一致申報；本頁摘要不取代 Play Console 表單。</p>
        </section>

        <section class="policy" id="rights">
          <p class="section-label">07 · Rights</p><h2>你的資料權利</h2>
          <p>在法令允許範圍內，你可以就本公司持有的個人資料提出下列要求：</p>
          <ul class="rights"><li>查詢、閱覽或請求製給複製本。</li><li>請求補充或更正不正確、不完整的資料。</li><li>請求停止蒐集、處理或利用個人資料。</li><li>請求刪除個人資料及帳號。</li></ul>
          <p>為避免未經授權的存取或刪除，我們可能先驗證申請人的帳號或身分。若依法必須保存資料、涉及他人權利或有其他法定例外，我們會說明無法立即完成要求的理由。</p>
        </section>

        <section class="policy" id="security">
          <p class="section-label">08 · Security</p><h2>資料安全措施</h2>
          <div class="security"><div><span class="icon" aria-hidden="true">鎖</span><h3>裝置端保護</h3><p>登入與裝置 token 以 Android Keystore 保護；密碼不寫入本機資料庫、偏好設定或紀錄。</p></div><div><span class="icon" aria-hidden="true">網</span><h3>傳輸與後端</h3><p>App 固定使用 HTTPS 後端並禁止明文 HTTP；後端以雜湊密碼與權杖、權限控管及速率限制保護服務。</p></div><div><span class="icon" aria-hidden="true">備</span><h3>備份與紀錄</h3><p>App 私有資料已排除 Android 系統備份與裝置移轉；正式版未整合第三方分析、廣告或 crash reporting。</p></div></div>
          <p class="notice">任何系統皆無法保證絕對安全。若發現疑似未授權存取、資料外洩或其他安全事件，請立即使用下方聯絡方式通知我們。</p>
        </section>

        <section class="policy">
          <p class="section-label">09 · Changes</p><h2>政策變更與兒少使用</h2>
          <p>OpenvoKao 是供公司營業與電子發票作業使用的工具，不以兒童為服務對象。我們可能因功能、供應商或法令變更更新本政策；重大變更會在本頁或 App 內提供適當通知，頁首會標示最新更新日期。</p>
        </section>

        <section class="contact" id="contact">
          <div><p class="section-label">10 · Contact</p><h2>隱私與資料申請聯絡窗口</h2><p>若對本政策、資料處理或權利行使有疑問，請聯絡嘉萱漢方有限公司。</p></div>
          <div class="contact-links"><a href="mailto:wii543@gmail.com">wii543@gmail.com</a><a href="tel:0800000783">服務電話 0800-000-783</a></div>
        </section>
      </article>
    </div>
  </main>

  <footer><span><strong>OpenvoKao</strong> · 嘉萱漢方有限公司</span><span><a href="#data-safety">Data safety</a> · <a href="/account-deletion">刪除帳號</a></span></footer>
</body>
</html>`;
}
