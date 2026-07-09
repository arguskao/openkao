export interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

type PrintJobPayload = {
  remoteId: string;
  invoiceNumber: string;
  randomNumber: string;
  issuedAt: string;
  sellerName?: string;
  sellerIdentifier?: string;
  buyerIdentifier?: string;
  totalAmount: number;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  qrCodePayload?: string;
  barcodePayload?: string;
};

type DeviceSession = {
  id: string;
  company_id: string;
  store_id: string | null;
  name: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: jsonHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return html(adminPage());
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "openvokao-backend" });
      }

      if (url.pathname === "/api/devices/register" && request.method === "POST") {
        requireAdmin(request, env);
        return registerDevice(request, env);
      }

      if (url.pathname === "/api/devices/me" && request.method === "GET") {
        const device = await requireDevice(request, env);
        return getDeviceMe(env, device);
      }

      if (url.pathname === "/api/print-jobs/pending" && request.method === "GET") {
        const device = await requireDevice(request, env);
        return listPendingPrintJobs(env, device);
      }

      const printJobDetail = url.pathname.match(/^\/api\/print-jobs\/([^/]+)$/);
      if (printJobDetail && request.method === "GET") {
        const device = await requireDevice(request, env);
        return getPrintJob(env, device, printJobDetail[1]);
      }

      const printJobPrinted = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/printed$/);
      if (printJobPrinted && request.method === "POST") {
        const device = await requireDevice(request, env);
        return updatePrintJobStatus(env, device, printJobPrinted[1], "printed");
      }

      const printJobFailed = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/failed$/);
      if (printJobFailed && request.method === "POST") {
        const device = await requireDevice(request, env);
        return updatePrintJobStatus(env, device, printJobFailed[1], "failed", request);
      }

      if (url.pathname === "/api/admin/summary" && request.method === "GET") {
        requireAdmin(request, env);
        return adminSummary(env);
      }

      if (url.pathname === "/api/admin/companies" && request.method === "POST") {
        requireAdmin(request, env);
        return createCompany(request, env);
      }

      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        requireAdmin(request, env);
        return listProducts(env, url);
      }

      if (url.pathname === "/api/admin/products" && request.method === "POST") {
        requireAdmin(request, env);
        return createProduct(request, env);
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "GET") {
        requireAdmin(request, env);
        return adminListPrintJobs(env);
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "POST") {
        requireAdmin(request, env);
        return createPrintJob(request, env);
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "unknown_error";
      return json({ error: message }, status);
    }
  }
};

async function registerDevice(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    companyId: string;
    storeId?: string;
    name: string;
    platform?: string;
  }>(request);

  requireString(input.companyId, "companyId");
  requireString(input.name, "name");

  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, store_id, name, token, platform)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.companyId, input.storeId ?? null, input.name, token, input.platform ?? "ios")
    .run();

  return json({ id, token });
}

async function getDeviceMe(env: Env, device: DeviceSession): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT
       d.id,
       d.name,
       d.platform,
       d.company_id,
       c.name AS company_name,
       d.store_id,
       s.name AS store_name,
       d.last_seen_at
     FROM devices d
     LEFT JOIN companies c ON c.id = d.company_id
     LEFT JOIN stores s ON s.id = d.store_id
     WHERE d.id = ?`
  )
    .bind(device.id)
    .first<{
      id: string;
      name: string;
      platform: string;
      company_id: string;
      company_name: string | null;
      store_id: string | null;
      store_name: string | null;
      last_seen_at: string | null;
    }>();

  if (!row) {
    throw new HttpError(404, "device_not_found");
  }

  return json({
    id: row.id,
    name: row.name,
    platform: row.platform,
    companyId: row.company_id,
    companyName: row.company_name,
    storeId: row.store_id,
    storeName: row.store_name,
    lastSeenAt: row.last_seen_at,
    isBound: true
  });
}

async function listPendingPrintJobs(env: Env, device: DeviceSession): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, payload_json, status, created_at
     FROM print_jobs
     WHERE status = 'pending'
       AND company_id = ?
       AND (device_id IS NULL OR device_id = ?)
     ORDER BY created_at ASC
     LIMIT 50`
  )
    .bind(device.company_id, device.id)
    .all<{ id: string; payload_json: string; status: string; created_at: string }>();

  return json({
    jobs: result.results.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      payload: parsePayload(row.payload_json)
    }))
  });
}

async function getPrintJob(env: Env, device: DeviceSession, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, payload_json, status, created_at
     FROM print_jobs
     WHERE id = ?
       AND company_id = ?
       AND (device_id IS NULL OR device_id = ?)`
  )
    .bind(id, device.company_id, device.id)
    .first<{ id: string; payload_json: string; status: string; created_at: string }>();

  if (!row) {
    throw new HttpError(404, "print_job_not_found");
  }

  return json({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    payload: parsePayload(row.payload_json)
  });
}

async function updatePrintJobStatus(
  env: Env,
  device: DeviceSession,
  id: string,
  status: "printed" | "failed",
  request?: Request
): Promise<Response> {
  const input = request ? await readJson<{ message?: string }>(request) : {};
  const message = input.message ?? null;
  const printedAt = status === "printed" ? new Date().toISOString() : null;

  const result = await env.DB.prepare(
    `UPDATE print_jobs
     SET status = ?, last_error = ?, printed_at = COALESCE(?, printed_at), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND company_id = ?
       AND (device_id IS NULL OR device_id = ?)`
  )
    .bind(status, status === "failed" ? message : null, printedAt, id, device.company_id, device.id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "print_job_not_found");
  }

  await env.DB.prepare(
    `INSERT INTO print_logs (id, print_job_id, device_id, status, message)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), id, device.id, status, message)
    .run();

  return json({ ok: true });
}

async function adminSummary(env: Env): Promise<Response> {
  const counts = await Promise.all([
    count(env, "companies"),
    count(env, "devices"),
    count(env, "products"),
    count(env, "invoices"),
    count(env, "print_jobs")
  ]);

  return json({
    companies: counts[0],
    devices: counts[1],
    products: counts[2],
    invoices: counts[3],
    printJobs: counts[4]
  });
}

async function createCompany(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{ name: string; taxId: string }>(request);
  requireString(input.name, "name");
  requireString(input.taxId, "taxId");

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO companies (id, name, tax_id, amego_app_key_secret_name)
     VALUES (?, ?, ?, ?)`
  )
    .bind(id, input.name, input.taxId, `AMEGO_APP_KEY_${id.replaceAll("-", "_")}`)
    .run();

  const storeId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO stores (id, company_id, name)
     VALUES (?, ?, ?)`
  )
    .bind(storeId, id, "預設門市")
    .run();

  return json({ id, storeId });
}

async function listProducts(env: Env, url: URL): Promise<Response> {
  const companyId = url.searchParams.get("companyId");
  requireString(companyId, "companyId");

  const result = await env.DB.prepare(
    `SELECT id, name, price, is_active, created_at
     FROM products
     WHERE company_id = ?
     ORDER BY name ASC`
  )
    .bind(companyId)
    .all();

  return json({ products: result.results });
}

async function createProduct(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    companyId: string;
    categoryId?: string;
    name: string;
    price: number;
  }>(request);

  requireString(input.companyId, "companyId");
  requireString(input.name, "name");
  requirePositiveInteger(input.price, "price");

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, input.companyId, input.categoryId ?? null, input.name, input.price)
    .run();

  return json({ id });
}

async function adminListPrintJobs(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, company_id, device_id, status, payload_json, last_error, printed_at, created_at
     FROM print_jobs
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .all<{
      id: string;
      company_id: string;
      device_id: string | null;
      status: string;
      payload_json: string;
      last_error: string | null;
      printed_at: string | null;
      created_at: string;
    }>();

  return json({
    jobs: result.results.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      deviceId: row.device_id,
      status: row.status,
      payload: parsePayload(row.payload_json),
      lastError: row.last_error,
      printedAt: row.printed_at,
      createdAt: row.created_at
    }))
  });
}

async function createPrintJob(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    companyId: string;
    storeId?: string;
    deviceId?: string;
    invoiceNumber: string;
    randomNumber: string;
    issuedAt?: string;
    sellerName?: string;
    sellerIdentifier: string;
    buyerIdentifier?: string;
    totalAmount: number;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    qrCodePayload?: string;
    barcodePayload?: string;
  }>(request);

  requireString(input.companyId, "companyId");
  requireString(input.invoiceNumber, "invoiceNumber");
  requireString(input.randomNumber, "randomNumber");
  requireString(input.sellerIdentifier, "sellerIdentifier");
  requirePositiveInteger(input.totalAmount, "totalAmount");

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, "items_required");
  }

  const invoiceId = crypto.randomUUID();
  const issuedAt = input.issuedAt ?? new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO invoices (
       id, company_id, store_id, invoice_number, random_number, issued_at,
       seller_name, seller_identifier, buyer_identifier, total_amount
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      invoiceId,
      input.companyId,
      input.storeId ?? null,
      input.invoiceNumber,
      input.randomNumber,
      issuedAt,
      input.sellerName ?? null,
      input.sellerIdentifier,
      input.buyerIdentifier ?? null,
      input.totalAmount
    )
    .run();

  const items = input.items.map((item) => {
    requireString(item.name, "item.name");
    requirePositiveInteger(item.quantity, "item.quantity");
    requirePositiveInteger(item.unitPrice, "item.unitPrice");
    return {
      id: crypto.randomUUID(),
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice
    };
  });

  for (const item of items) {
    await env.DB.prepare(
      `INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(item.id, invoiceId, item.name, item.quantity, item.unitPrice, item.amount)
      .run();
  }

  const jobId = crypto.randomUUID();
  const payload: PrintJobPayload = {
    remoteId: jobId,
    invoiceNumber: input.invoiceNumber,
    randomNumber: input.randomNumber,
    issuedAt,
    sellerName: input.sellerName,
    sellerIdentifier: input.sellerIdentifier,
    buyerIdentifier: input.buyerIdentifier,
    totalAmount: input.totalAmount,
    items: items.map(({ id, name, quantity, unitPrice }) => ({ id, name, quantity, unitPrice })),
    qrCodePayload: input.qrCodePayload,
    barcodePayload: input.barcodePayload ?? input.invoiceNumber
  };

  await env.DB.prepare(
    `INSERT INTO print_jobs (id, company_id, store_id, device_id, invoice_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(jobId, input.companyId, input.storeId ?? null, input.deviceId ?? null, invoiceId, JSON.stringify(payload))
    .run();

  return json({ id: jobId, invoiceId, payload });
}

async function requireDevice(request: Request, env: Env): Promise<DeviceSession> {
  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "missing_device_token");
  }

  const device = await env.DB.prepare(
    `SELECT id, company_id, store_id, name
     FROM devices
     WHERE token = ?`
  )
    .bind(token)
    .first<DeviceSession>();

  if (!device) {
    throw new HttpError(401, "invalid_device_token");
  }

  await env.DB.prepare(
    `UPDATE devices
     SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(device.id)
    .run();

  return device;
}

function requireAdmin(request: Request, env: Env): void {
  const configuredToken = env.ADMIN_TOKEN;
  if (!configuredToken) {
    throw new HttpError(500, "admin_token_not_configured");
  }

  if (bearerToken(request) !== configuredToken) {
    throw new HttpError(401, "invalid_admin_token");
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

async function count(env: Env, table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS value FROM ${table}`).first<{ value: number }>();
  return row?.value ?? 0;
}

function parsePayload(payload: string): PrintJobPayload {
  return JSON.parse(payload) as PrintJobPayload;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field}_required`);
  }
}

function requirePositiveInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field}_invalid`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: jsonHeaders
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function adminPage(): string {
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
