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
  company_id: number;
  name: string;
};

type AdminUserRow = {
  id: number;
  account: string;
  name: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  created_at: string;
};

type UserSession = {
  token: string;
  user_id: number;
  company_id: number;
  name: string | null;
  account: string;
  phone: string | null;
  company_name: string;
  tax_id: string;
  address: string | null;
  amego_app_key_secret_name: string | null;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
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

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        return registerAccount(request, env);
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return loginAccount(request, env);
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const session = await requireUserSession(request, env);
        return getAuthMe(env, session);
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const session = await requireUserSession(request, env);
        return logoutAccount(env, session);
      }

      if (url.pathname === "/api/reports/sales" && request.method === "GET") {
        const session = await requireUserSession(request, env);
        return listSalesReport(env, session, url);
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

      if (url.pathname === "/api/catalog/categories" && request.method === "GET") {
        const device = await requireDevice(request, env);
        return listCatalogCategories(env, device);
      }

      if (url.pathname === "/api/catalog/categories" && request.method === "POST") {
        const device = await requireDevice(request, env);
        return createCatalogCategory(request, env, device);
      }

      const catalogCategoryMatch = url.pathname.match(/^\/api\/catalog\/categories\/([^/]+)$/);
      if (catalogCategoryMatch && request.method === "PUT") {
        const device = await requireDevice(request, env);
        return updateCatalogCategory(request, env, device, catalogCategoryMatch[1]);
      }

      if (catalogCategoryMatch && request.method === "DELETE") {
        const device = await requireDevice(request, env);
        return deleteCatalogCategory(env, device, catalogCategoryMatch[1]);
      }

      if (url.pathname === "/api/catalog/products" && request.method === "GET") {
        const device = await requireDevice(request, env);
        return listCatalogProducts(env, device);
      }

      if (url.pathname === "/api/catalog/products" && request.method === "POST") {
        const device = await requireDevice(request, env);
        return createCatalogProduct(request, env, device);
      }

      if (url.pathname === "/api/catalog/settings" && request.method === "PUT") {
        const device = await requireDevice(request, env);
        return updateCatalogSettings(request, env, device);
      }

      const catalogProductMatch = url.pathname.match(/^\/api\/catalog\/products\/([^/]+)$/);
      if (catalogProductMatch && request.method === "PUT") {
        const device = await requireDevice(request, env);
        return updateCatalogProduct(request, env, device, catalogProductMatch[1]);
      }

      if (catalogProductMatch && request.method === "DELETE") {
        const device = await requireDevice(request, env);
        return deleteCatalogProduct(env, device, catalogProductMatch[1]);
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

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        requireAdmin(request, env);
        return adminListUsers(env, url);
      }

      const adminUserResetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
      if (adminUserResetMatch && request.method === "POST") {
        requireAdmin(request, env);
        return adminResetUserPassword(request, env, adminUserResetMatch[1]);
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
      const status =
        error instanceof HttpError
          ? error.status
          : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
            ? error.status
            : 500;
      const message = error instanceof Error ? error.message : "unknown_error";
      return json({ error: message }, status);
    }
  }
};

async function registerAccount(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    name: string;
    phone?: string;
    account: string;
    password: string;
    companyName: string;
    taxId: string;
    address?: string;
    deviceName?: string;
    platform?: string;
  }>(request);

  requireString(input.name, "name");
  requireString(input.account, "account");
  requireString(input.password, "password");
  requireString(input.companyName, "companyName");
  requireString(input.taxId, "taxId");

  const account = normalizeAccount(input.account);
  const taxId = input.taxId.trim();
  const phone = normalizeOptionalString(input.phone);
  const address = normalizeOptionalString(input.address);
  const deviceName = normalizeOptionalString(input.deviceName) ?? "iPhone";
  const platform = normalizeOptionalString(input.platform) ?? "ios";

  requirePassword(input.password);

  const existingEmail = await env.DB.prepare(
    `SELECT id
     FROM users
     WHERE lower(email) = ?`
  )
    .bind(account)
    .first<{ id: number }>();
  if (existingEmail) {
    throw new HttpError(409, "account_already_registered");
  }

  const existingCompany = await env.DB.prepare(
    `SELECT id
     FROM companies
     WHERE tax_id = ?`
  )
    .bind(taxId)
    .first<{ id: number }>();
  if (existingCompany) {
    throw new HttpError(409, "company_tax_id_exists");
  }

  const companyResult = await env.DB.prepare(
    `INSERT INTO companies (id, name, tax_id, address, amego_app_key_secret_name)
     VALUES (NULL, ?, ?, ?, ?)`
  )
    .bind(input.companyName.trim(), taxId, address, "AMEGO_APP_KEY_PENDING")
    .run();
  const companyId = Number(companyResult.meta.last_row_id);

  await env.DB.prepare(
    `UPDATE companies
     SET amego_app_key_secret_name = ?
     WHERE id = ?`
  )
    .bind(`AMEGO_APP_KEY_${companyId}`, companyId)
    .run();

  const passwordHash = await hashPassword(input.password);

  const userResult = await env.DB.prepare(
    `INSERT INTO users (id, company_id, email, password_hash, name, phone)
     VALUES (NULL, ?, ?, ?, ?, ?)`
  )
    .bind(companyId, account, passwordHash, input.name.trim(), phone)
    .run();
  const userId = Number(userResult.meta.last_row_id);

  const sessionToken = generateSessionToken();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token, user_id, company_id)
     VALUES (?, ?, ?)`
  )
    .bind(sessionToken, userId, companyId)
    .run();

  const device = await ensureCompanyDevice(env, companyId, deviceName, platform);

  return jsonAuthPayload({
    authToken: sessionToken,
    user: {
      id: userId,
      name: input.name.trim(),
      account,
      phone
    },
    company: {
      id: companyId,
      name: input.companyName.trim(),
      taxId,
      address,
      appKey: `AMEGO_APP_KEY_${companyId}`
    },
    device
  });
}

async function loginAccount(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    account: string;
    password: string;
    deviceName?: string;
    platform?: string;
  }>(request);

  requireString(input.account, "account");
  requireString(input.password, "password");

  const account = normalizeAccount(input.account);
  const row = await env.DB.prepare(
    `SELECT
       u.id,
       u.company_id,
       u.email AS account,
       u.password_hash,
       u.name,
       u.phone,
       c.name AS company_name,
       c.tax_id,
       c.address,
       c.amego_app_key_secret_name
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE lower(u.email) = ?`
  )
    .bind(account)
    .first<{
      id: number;
      company_id: number | null;
      account: string;
      password_hash: string | null;
      name: string | null;
      phone: string | null;
      company_name: string;
      tax_id: string;
      address: string | null;
      amego_app_key_secret_name: string | null;
    }>();

  if (!row?.company_id || !row.password_hash) {
    throw new HttpError(401, "invalid_credentials");
  }

  const verified = await verifyPassword(input.password, row.password_hash);
  if (!verified) {
    throw new HttpError(401, "invalid_credentials");
  }

  const sessionToken = generateSessionToken();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token, user_id, company_id)
     VALUES (?, ?, ?)`
  )
    .bind(sessionToken, row.id, row.company_id)
    .run();

  const device = await ensureCompanyDevice(
    env,
    row.company_id,
    normalizeOptionalString(input.deviceName) ?? "iPhone",
    normalizeOptionalString(input.platform) ?? "ios"
  );

  return jsonAuthPayload({
    authToken: sessionToken,
    user: {
      id: row.id,
      name: row.name,
      account: row.account,
      phone: row.phone
    },
    company: {
      id: row.company_id,
      name: row.company_name,
      taxId: row.tax_id,
      address: row.address,
      appKey: row.amego_app_key_secret_name ?? `AMEGO_APP_KEY_${row.company_id}`
    },
    device
  });
}

async function getAuthMe(env: Env, session: UserSession): Promise<Response> {
  const device = await fetchPrimaryCompanyDevice(env, session.company_id);

  return jsonAuthPayload({
    authToken: session.token,
    user: {
      id: session.user_id,
      name: session.name,
      account: session.account,
      phone: session.phone
    },
    company: {
      id: session.company_id,
      name: session.company_name,
      taxId: session.tax_id,
      address: session.address,
      appKey: session.amego_app_key_secret_name ?? `AMEGO_APP_KEY_${session.company_id}`
    },
    device
  });
}

async function logoutAccount(env: Env, session: UserSession): Promise<Response> {
  await env.DB.prepare(
    `DELETE FROM auth_sessions
     WHERE token = ?`
  )
    .bind(session.token)
    .run();

  return json({ ok: true });
}

type SalesInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  random_number: string;
  issued_at: string;
  seller_name: string | null;
  seller_identifier: string | null;
  buyer_identifier: string | null;
  total_amount: number;
  print_status: string | null;
  item_id: string | null;
  item_name: string | null;
  item_quantity: number | null;
  item_unit_price: number | null;
  item_amount: number | null;
};

async function listSalesReport(env: Env, session: UserSession, url: URL): Promise<Response> {
  const startDate = normalizeReportDate(url.searchParams.get("startDate"), "startDate");
  const endDate = normalizeReportDate(url.searchParams.get("endDate"), "endDate");

  if (startDate > endDate) {
    throw new HttpError(400, "date_range_invalid");
  }

  const result = await env.DB.prepare(
    `SELECT
       i.id AS invoice_id,
       i.invoice_number,
       i.random_number,
       i.issued_at,
       i.seller_name,
       i.seller_identifier,
       i.buyer_identifier,
       i.total_amount,
       latest_job.status AS print_status,
       ii.id AS item_id,
       ii.name AS item_name,
       ii.quantity AS item_quantity,
       ii.unit_price AS item_unit_price,
       ii.amount AS item_amount
     FROM invoices i
     LEFT JOIN (
       SELECT pj.invoice_id, pj.status
       FROM print_jobs pj
       INNER JOIN (
         SELECT invoice_id, MAX(created_at) AS max_created_at
         FROM print_jobs
         WHERE company_id = ?
         GROUP BY invoice_id
       ) latest
         ON latest.invoice_id = pj.invoice_id
        AND latest.max_created_at = pj.created_at
       WHERE pj.company_id = ?
     ) latest_job ON latest_job.invoice_id = i.id
     LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.company_id = ?
       AND date(i.issued_at) BETWEEN date(?) AND date(?)
     ORDER BY i.issued_at DESC, ii.rowid ASC`
  )
    .bind(session.company_id, session.company_id, session.company_id, startDate, endDate)
    .all<SalesInvoiceRow>();

  const invoices = new Map<string, {
    id: string;
    invoiceNumber: string;
    randomNumber: string;
    issuedAt: string;
    sellerName: string | null;
    sellerIdentifier: string | null;
    buyerIdentifier: string | null;
    totalAmount: number;
    printStatus: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
  }>();

  for (const row of result.results) {
    if (!invoices.has(row.invoice_id)) {
      invoices.set(row.invoice_id, {
        id: row.invoice_id,
        invoiceNumber: row.invoice_number,
        randomNumber: row.random_number,
        issuedAt: row.issued_at,
        sellerName: row.seller_name,
        sellerIdentifier: row.seller_identifier,
        buyerIdentifier: row.buyer_identifier,
        totalAmount: Number(row.total_amount ?? 0),
        printStatus: normalizePrintStatusValue(row.print_status),
        items: []
      });
    }

    if (row.item_id && row.item_name) {
      invoices.get(row.invoice_id)?.items.push({
        id: row.item_id,
        name: row.item_name,
        quantity: Number(row.item_quantity ?? 0),
        unitPrice: Number(row.item_unit_price ?? 0),
        amount: Number(row.item_amount ?? 0)
      });
    }
  }

  return json({
    invoices: Array.from(invoices.values())
  });
}

async function registerDevice(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    companyId: number | string;
    name: string;
    platform?: string;
  }>(request);

  const companyId = parsePositiveId(input.companyId, "companyId");
  requireString(input.name, "name");

  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, platform)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, input.name, token, input.platform ?? "ios")
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
       d.last_seen_at
     FROM devices d
     LEFT JOIN companies c ON c.id = d.company_id
     WHERE d.id = ?`
  )
    .bind(device.id)
    .first<{
      id: string;
      name: string;
      platform: string;
      company_id: number;
      company_name: string | null;
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

type CatalogCategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  status: string | null;
  product_count?: number | null;
};

type CatalogProductRow = {
  id: number;
  category_id: number | null;
  category_name: string | null;
  name: string;
  price: number;
  decimal_places: number | null;
  image_path: string | null;
  is_active: number;
  tax_type: string | null;
  sort_order: number | null;
};

async function listCatalogCategories(env: Env, device: DeviceSession): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
       c.id,
       c.name,
       c.sort_order,
       c.status,
       COUNT(p.id) AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.company_id = c.company_id
     WHERE c.company_id = ?
     GROUP BY c.id, c.name, c.sort_order, c.status
     ORDER BY c.sort_order ASC, c.name ASC`
  )
    .bind(device.company_id)
    .all<CatalogCategoryRow>();

  return json({
    categories: result.results.map(mapCatalogCategoryRow)
  });
}

async function createCatalogCategory(request: Request, env: Env, device: DeviceSession): Promise<Response> {
  const input = await readJson<{ name: string; sortOrder?: number; status?: string }>(request);
  requireString(input.name, "name");
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO categories (id, company_id, name, sort_order, status)
     VALUES (NULL, ?, ?, ?, ?)`
  )
    .bind(device.company_id, input.name.trim(), sortOrder, status)
    .run();
  const id = Number(result.meta.last_row_id);

  return json({
    category: {
      id,
      name: input.name.trim(),
      sortOrder,
      status,
      productCount: 0
    }
  }, 201);
}

async function updateCatalogCategory(
  request: Request,
  env: Env,
  device: DeviceSession,
  categoryIdValue: string
): Promise<Response> {
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const input = await readJson<{ name: string; sortOrder?: number; status?: string }>(request);
  requireString(input.name, "name");
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `UPDATE categories
     SET name = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  )
    .bind(input.name.trim(), sortOrder, status, categoryId, device.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "category_not_found");
  }

  return json({
    category: {
      id: categoryId,
      name: input.name.trim(),
      sortOrder,
      status,
      productCount: 0
    }
  });
}

async function deleteCatalogCategory(env: Env, device: DeviceSession, categoryIdValue: string): Promise<Response> {
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const result = await env.DB.prepare(
    `DELETE FROM categories
     WHERE id = ? AND company_id = ?`
  )
    .bind(categoryId, device.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "category_not_found");
  }

  return json({ ok: true });
}

async function listCatalogProducts(env: Env, device: DeviceSession): Promise<Response> {
  const priceDecimalPlaces = await fetchCompanyPriceDecimalPlaces(env, device.company_id);
  const result = await env.DB.prepare(
    `SELECT
       p.id,
       p.category_id,
       c.name AS category_name,
       p.name,
       p.price,
       p.decimal_places,
       p.image_path,
       p.is_active,
       p.tax_type,
       p.sort_order
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.company_id = ?
     ORDER BY p.sort_order ASC, p.name ASC`
  )
    .bind(device.company_id)
    .all<CatalogProductRow>();

  return json({
    priceDecimalPlaces,
    products: result.results.map(mapCatalogProductRow)
  });
}

async function createCatalogProduct(request: Request, env: Env, device: DeviceSession): Promise<Response> {
  const input = await readJson<{
    categoryId?: number | string | null;
    name: string;
    price: number;
    imagePath?: string | null;
    status?: string;
    taxType?: string;
    sortOrder?: number;
  }>(request);

  requireString(input.name, "name");
  requirePositiveInteger(input.price, "price");
  const normalizedCategoryId = await validateCategoryId(env, device.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, device.company_id);
  const sortOrder = input.sortOrder == null
    ? await nextProductSortOrder(env, device.company_id)
    : normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price, decimal_places, image_path, is_active, tax_type, sort_order)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      device.company_id,
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder
    )
    .run();
  const id = Number(result.meta.last_row_id);

  return json({
    product: await fetchCatalogProductById(env, device.company_id, id)
  }, 201);
}

async function updateCatalogProduct(
  request: Request,
  env: Env,
  device: DeviceSession,
  productIdValue: string
): Promise<Response> {
  const productId = parsePositiveId(productIdValue, "productId");
  const input = await readJson<{
    categoryId?: number | string | null;
    name: string;
    price: number;
    imagePath?: string | null;
    status?: string;
    taxType?: string;
    sortOrder?: number;
  }>(request);

  requireString(input.name, "name");
  requirePositiveInteger(input.price, "price");
  const normalizedCategoryId = await validateCategoryId(env, device.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, device.company_id);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `UPDATE products
     SET category_id = ?, name = ?, price = ?, decimal_places = ?, image_path = ?, is_active = ?, tax_type = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  )
    .bind(
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder,
      productId,
      device.company_id
    )
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({
    product: await fetchCatalogProductById(env, device.company_id, productId)
  });
}

async function updateCatalogSettings(request: Request, env: Env, device: DeviceSession): Promise<Response> {
  const input = await readJson<{ priceDecimalPlaces?: number }>(request);
  const nextValue = normalizeDecimalPlaces(input.priceDecimalPlaces);
  const currentValue = await fetchCompanyPriceDecimalPlaces(env, device.company_id);

  if (nextValue !== currentValue) {
    if (nextValue > currentValue) {
      const multiplier = integerPower10(nextValue - currentValue);
      await env.DB.prepare(
        `UPDATE products
         SET price = price * ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ?`
      )
        .bind(multiplier, nextValue, device.company_id)
        .run();
    } else {
      const divisor = integerPower10(currentValue - nextValue);
      const precisionLoss = await env.DB.prepare(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE company_id = ?
           AND (price % ?) != 0`
      )
        .bind(device.company_id, divisor)
        .first<{ value: number | null }>();

      if (Number(precisionLoss?.value ?? 0) > 0) {
        throw new HttpError(400, "目前商品價格含有更細的小數，不能直接降低小數位數。");
      }

      await env.DB.prepare(
        `UPDATE products
         SET price = price / ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ?`
      )
        .bind(divisor, nextValue, device.company_id)
        .run();
    }

    await env.DB.prepare(
      `UPDATE companies
       SET price_decimal_places = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(nextValue, device.company_id)
      .run();
  }

  return json({ priceDecimalPlaces: nextValue });
}

async function deleteCatalogProduct(env: Env, device: DeviceSession, productIdValue: string): Promise<Response> {
  const productId = parsePositiveId(productIdValue, "productId");
  const result = await env.DB.prepare(
    `DELETE FROM products
     WHERE id = ? AND company_id = ?`
  )
    .bind(productId, device.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({ ok: true });
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

  const companyResult = await env.DB.prepare(
    `INSERT INTO companies (id, name, tax_id, amego_app_key_secret_name)
     VALUES (NULL, ?, ?, ?)`
  )
    .bind(input.name, input.taxId, "AMEGO_APP_KEY_PENDING")
    .run();
  const id = Number(companyResult.meta.last_row_id);

  await env.DB.prepare(
    `UPDATE companies
     SET amego_app_key_secret_name = ?
     WHERE id = ?`
  )
    .bind(`AMEGO_APP_KEY_${id}`, id)
    .run();

  return json({ id });
}

async function listProducts(env: Env, url: URL): Promise<Response> {
  const companyId = parsePositiveId(url.searchParams.get("companyId"), "companyId");

  const result = await env.DB.prepare(
    `SELECT id, category_id, name, price, image_path, is_active, tax_type, sort_order, created_at, decimal_places
     FROM products
     WHERE company_id = ?
     ORDER BY sort_order ASC, name ASC`
  )
    .bind(companyId)
    .all<CatalogProductRow>();

  return json({ products: result.results.map(mapCatalogProductRow) });
}

async function createProduct(request: Request, env: Env): Promise<Response> {
  const input = await readJson<{
    companyId: number | string;
    categoryId?: number | string | null;
    name: string;
    price: number;
    imagePath?: string | null;
    status?: string;
    taxType?: string;
    sortOrder?: number;
  }>(request);

  const companyId = parsePositiveId(input.companyId, "companyId");
  requireString(input.name, "name");
  requirePositiveInteger(input.price, "price");
  const normalizedCategoryId = await validateCategoryId(env, companyId, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, companyId);
  const sortOrder = input.sortOrder == null
    ? await nextProductSortOrder(env, companyId)
    : normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price, decimal_places, image_path, is_active, tax_type, sort_order)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      companyId,
      normalizedCategoryId,
      input.name.trim(),
      input.price,
      decimalPlaces,
      normalizeOptionalString(input.imagePath),
      status === "顯示" ? 1 : 0,
      taxType,
      sortOrder
    )
    .run();

  return json({ id: Number(result.meta.last_row_id) });
}

async function adminListUsers(env: Env, url: URL): Promise<Response> {
  const companyIdParam = url.searchParams.get("companyId");
  const companyId = companyIdParam ? parsePositiveId(companyIdParam, "companyId") : null;

  const result = companyId == null
    ? await env.DB.prepare(
        `SELECT
           u.id,
           u.email AS account,
           u.name,
           u.phone,
           u.company_id,
           c.name AS company_name,
           u.created_at
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         ORDER BY u.company_id ASC, u.id ASC`
      )
        .all<AdminUserRow>()
    : await env.DB.prepare(
        `SELECT
           u.id,
           u.email AS account,
           u.name,
           u.phone,
           u.company_id,
           c.name AS company_name,
           u.created_at
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.company_id = ?
         ORDER BY u.id ASC`
      )
        .bind(companyId)
        .all<AdminUserRow>();

  return json({
    users: result.results.map((row) => ({
      id: row.id,
      account: row.account,
      name: row.name,
      phone: row.phone,
      companyId: row.company_id,
      companyName: row.company_name,
      createdAt: row.created_at
    }))
  });
}

async function adminResetUserPassword(
  request: Request,
  env: Env,
  userIdValue: string
): Promise<Response> {
  const userId = parsePositiveId(userIdValue, "userId");
  const input = await readJson<{ password: string }>(request);
  requireString(input.password, "password");
  requirePassword(input.password);

  const passwordHash = await hashPassword(input.password);
  const result = await env.DB.prepare(
    `UPDATE users
     SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(passwordHash, userId)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "user_not_found");
  }

  return json({ ok: true, userId });
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
      company_id: number;
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
    companyId: number | string;
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

  const companyId = parsePositiveId(input.companyId, "companyId");
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
       id, company_id, invoice_number, random_number, issued_at,
       seller_name, seller_identifier, buyer_identifier, total_amount
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      invoiceId,
      companyId,
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
    `INSERT INTO print_jobs (id, company_id, device_id, invoice_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(jobId, companyId, input.deviceId ?? null, invoiceId, JSON.stringify(payload))
    .run();

  return json({ id: jobId, invoiceId, payload });
}

async function requireDevice(request: Request, env: Env): Promise<DeviceSession> {
  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "missing_device_token");
  }

  const device = await env.DB.prepare(
    `SELECT id, company_id, name
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

async function requireUserSession(request: Request, env: Env): Promise<UserSession> {
  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "missing_auth_token");
  }

  const session = await env.DB.prepare(
    `SELECT
       s.token,
       s.user_id,
       s.company_id,
       u.name,
       u.email AS account,
       u.phone,
       c.name AS company_name,
       c.tax_id,
       c.address,
       c.amego_app_key_secret_name
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.id = s.company_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first<UserSession>();

  if (!session) {
    throw new HttpError(401, "invalid_auth_token");
  }

  await env.DB.prepare(
    `UPDATE auth_sessions
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE token = ?`
  )
    .bind(token)
    .run();

  return session;
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

function mapCatalogCategoryRow(row: CatalogCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order ?? 0),
    status: normalizeStatus(row.status),
    productCount: Number(row.product_count ?? 0)
  };
}

function mapCatalogProductRow(row: CatalogProductRow) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    price: Number(row.price),
    decimalPlaces: Number(row.decimal_places ?? 0),
    imagePath: row.image_path,
    status: row.is_active === 0 ? "隱藏" : "顯示",
    taxType: normalizeTaxType(row.tax_type),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

async function fetchCatalogProductById(env: Env, companyId: number, productId: number) {
  const row = await env.DB.prepare(
    `SELECT
       p.id,
       p.category_id,
       c.name AS category_name,
       p.name,
       p.price,
       p.decimal_places,
       p.image_path,
       p.is_active,
       p.tax_type,
       p.sort_order
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.company_id = ?`
  )
    .bind(productId, companyId)
    .first<CatalogProductRow>();

  if (!row) {
    throw new HttpError(404, "product_not_found");
  }

  return mapCatalogProductRow(row);
}

async function validateCategoryId(
  env: Env,
  companyId: number,
  categoryId: number | string | null
): Promise<number | null> {
  if (categoryId == null || categoryId === "") {
    return null;
  }

  const normalized = parsePositiveId(categoryId, "categoryId");

  const category = await env.DB.prepare(
    `SELECT id
     FROM categories
     WHERE id = ? AND company_id = ?`
  )
    .bind(normalized, companyId)
    .first<{ id: number }>();

  if (!category) {
    throw new HttpError(400, "invalid_category_id");
  }

  return normalized;
}

async function nextProductSortOrder(env: Env, companyId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS value
     FROM products
     WHERE company_id = ?`
  )
    .bind(companyId)
    .first<{ value: number | null }>();

  return Number(row?.value ?? 0) + 1;
}

async function fetchCompanyPriceDecimalPlaces(env: Env, companyId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT price_decimal_places
     FROM companies
     WHERE id = ?`
  )
    .bind(companyId)
    .first<{ price_decimal_places: number | null }>();

  return normalizeDecimalPlaces(row?.price_decimal_places ?? 0);
}

function parsePositiveId(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[1-9]\d*$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  throw new HttpError(400, `${field}_invalid`);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeReportDate(value: string | null, field: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return value;
}

function normalizeStatus(value: unknown): string {
  return value === "隱藏" ? "隱藏" : "顯示";
}

function normalizePrintStatusValue(value: unknown): string {
  return value === "printed" || value === "failed" ? value : "pending";
}

function normalizeTaxType(value: unknown): string {
  return value === "未稅" ? "未稅" : "含稅";
}

function normalizeSortOrder(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeDecimalPlaces(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4) {
    throw new HttpError(400, "decimal_places_invalid");
  }

  return value;
}

function integerPower10(exponent: number): number {
  let output = 1;
  for (let index = 0; index < exponent; index += 1) {
    output *= 10;
  }
  return output;
}

function normalizeAccount(value: string): string {
  const account = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(account)) {
    throw new HttpError(400, "account_invalid");
  }
  return account;
}

function requirePassword(value: string): void {
  if (value.trim().length < 6) {
    throw new HttpError(400, "password_too_short");
  }
}

function generateSessionToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsValue || !saltValue || !hashValue) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const derived = await derivePasswordHash(password, fromBase64(saltValue), iterations);
  return timingSafeEqual(derived, fromBase64(hashValue));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}

function toBase64(value: Uint8Array): string {
  let output = "";
  for (const byte of value) {
    output += String.fromCharCode(byte);
  }
  return btoa(output);
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }
  return output;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

async function ensureCompanyDevice(
  env: Env,
  companyId: number,
  deviceName: string,
  platform: string
) {
  const existing = await env.DB.prepare(
    `SELECT d.id, d.token, d.name
     FROM devices d
     WHERE d.company_id = ?
       AND d.name = ?
       AND d.platform = ?
     ORDER BY d.created_at ASC
     LIMIT 1`
  )
    .bind(companyId, deviceName, platform)
    .first<{
      id: string;
      token: string;
      name: string;
    }>();

  if (existing) {
    return {
      id: existing.id,
      token: existing.token,
      name: existing.name
    };
  }

  const id = crypto.randomUUID();
  const token = generateSessionToken();
  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, platform)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, deviceName, token, platform)
    .run();

  return {
    id,
    token,
    name: deviceName
  };
}

async function fetchPrimaryCompanyDevice(env: Env, companyId: number) {
  const device = await env.DB.prepare(
    `SELECT d.id, d.token, d.name
     FROM devices d
     WHERE d.company_id = ?
     ORDER BY d.created_at ASC
     LIMIT 1`
  )
    .bind(companyId)
    .first<{
      id: string;
      token: string;
      name: string;
    }>();

  if (device) {
    return {
      id: device.id,
      token: device.token,
      name: device.name
    };
  }

  return ensureCompanyDevice(env, companyId, "iPhone", "ios");
}

function jsonAuthPayload(payload: {
  authToken: string;
  user: { id: number; name: string | null; account: string; phone: string | null };
  company: { id: number; name: string; taxId: string; address: string | null; appKey: string };
  device: { id: string; token: string; name: string };
}): Response {
  return json(payload);
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
