export interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  CORS_ALLOWED_ORIGINS?: string;
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

type DeviceIdentity = {
  id: string;
  name: string;
  token?: string;
};

type PrintJobRow = {
  id: string;
  payload_json: string;
  status: string;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempt_count: number | null;
};

type ManagedDeviceRow = {
  id: string;
  company_id: number;
  name: string;
  platform: string;
  installation_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type AuditLogRow = {
  id: string;
  company_id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_account: string | null;
  actor_device_id: string | null;
  target_type: string;
  target_id: string;
  action: string;
  details_json: string | null;
  created_at: string;
};

type AdminUserRow = {
  id: number;
  account: string;
  name: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  role: string | null;
  created_at: string;
};

type UserSession = {
  token: string;
  user_id: number;
  company_id: number;
  device_id: string | null;
  role: string;
  name: string | null;
  account: string;
  phone: string | null;
  company_name: string;
  tax_id: string;
  address: string | null;
  amego_app_key: string | null;
};

type RequestContext = {
  requestId: string;
  startedAt: number;
  method: string;
  route: string;
  companyId?: number;
  userId?: number;
  deviceId?: string;
  actorType?: "user" | "device" | "admin" | "anonymous";
};

const AUTH_SESSION_DURATION_DAYS = 30;
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_REPORT_RANGE_DAYS = 93;

const allowedCorsRequestHeaders = new Set(["authorization", "content-type", "idempotency-key"]);

const baseSecurityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-store"
};

const adminContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'"
].join("; ");

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await checkPrintJobQueueHealth(env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const context: RequestContext = {
      requestId: request.headers.get("cf-ray")?.trim() || crypto.randomUUID(),
      startedAt: Date.now(),
      method: request.method,
      route: routeName(url.pathname)
    };
    const reply = (response: Response) => finalizeResponse(response, request, env, context);

    if (request.method === "OPTIONS") {
      return reply(handleOptions(request, env, url));
    }

    try {
      if (url.pathname === "/") {
        return reply(html(adminPage()));
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        return reply(json({ ok: true, service: "openvokao-backend" }));
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        await enforceRateLimit(request, env, "auth_register", 10, 10 * 60);
        return reply(await registerAccount(request, env));
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        await enforceRateLimit(request, env, "auth_login", 20, 10 * 60);
        return reply(await loginAccount(request, env, context));
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await getAuthMe(env, session));
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await logoutAccount(env, session));
      }

      if (url.pathname === "/api/reports/sales" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listSalesReport(env, session, url));
      }

      if (url.pathname === "/api/devices/register" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_devices_register", 30, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await registerDevice(request, env, context));
      }

      if (url.pathname === "/api/devices/me" && request.method === "GET") {
        const device = await requireDevice(request, env, context);
        return reply(await getDeviceMe(env, device));
      }

      if (url.pathname === "/api/devices" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listManagedDevices(env, session));
      }

      if (url.pathname === "/api/devices" && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await createManagedDevice(request, env, session));
      }

      if (url.pathname === "/api/devices/audit-logs" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listAuditLogs(env, session, url));
      }

      const managedDeviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
      if (managedDeviceMatch && request.method === "PUT") {
        const session = await requireUserSession(request, env, context);
        return reply(await updateManagedDevice(request, env, session, managedDeviceMatch[1]));
      }

      if (managedDeviceMatch && request.method === "DELETE") {
        const session = await requireUserSession(request, env, context);
        return reply(await revokeManagedDevice(env, session, managedDeviceMatch[1]));
      }

      const managedDeviceRotateMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/rotate-token$/);
      if (managedDeviceRotateMatch && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await rotateManagedDeviceToken(env, session, managedDeviceRotateMatch[1]));
      }

      if (url.pathname === "/api/print-jobs/pending" && request.method === "GET") {
        const device = await requireDevice(request, env, context);
        return reply(await listPendingPrintJobs(env, device, context));
      }

      if (url.pathname === "/api/catalog/categories" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listCatalogCategories(env, session));
      }

      if (url.pathname === "/api/catalog/categories" && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await createCatalogCategory(request, env, session));
      }

      const catalogCategoryMatch = url.pathname.match(/^\/api\/catalog\/categories\/([^/]+)$/);
      if (catalogCategoryMatch && request.method === "PUT") {
        const session = await requireUserSession(request, env, context);
        return reply(await updateCatalogCategory(request, env, session, catalogCategoryMatch[1]));
      }

      if (catalogCategoryMatch && request.method === "DELETE") {
        const session = await requireUserSession(request, env, context);
        return reply(await deleteCatalogCategory(env, session, catalogCategoryMatch[1]));
      }

      if (url.pathname === "/api/catalog/products" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listCatalogProducts(env, session));
      }

      if (url.pathname === "/api/catalog/products" && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await createCatalogProduct(request, env, session));
      }

      if (url.pathname === "/api/catalog/settings" && request.method === "PUT") {
        const session = await requireUserSession(request, env, context);
        return reply(await updateCatalogSettings(request, env, session));
      }

      const catalogProductMatch = url.pathname.match(/^\/api\/catalog\/products\/([^/]+)$/);
      if (catalogProductMatch && request.method === "PUT") {
        const session = await requireUserSession(request, env, context);
        return reply(await updateCatalogProduct(request, env, session, catalogProductMatch[1]));
      }

      if (catalogProductMatch && request.method === "DELETE") {
        const session = await requireUserSession(request, env, context);
        return reply(await deleteCatalogProduct(env, session, catalogProductMatch[1]));
      }

      const printJobDetail = url.pathname.match(/^\/api\/print-jobs\/([^/]+)$/);
      if (printJobDetail && request.method === "GET") {
        const device = await requireDevice(request, env, context);
        return reply(await getPrintJob(env, device, printJobDetail[1]));
      }

      const printJobPrinted = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/printed$/);
      if (printJobPrinted && request.method === "POST") {
        const device = await requireDevice(request, env, context);
        return reply(await updatePrintJobStatus(env, device, printJobPrinted[1], "printed", context));
      }

      const printJobFailed = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/failed$/);
      if (printJobFailed && request.method === "POST") {
        const device = await requireDevice(request, env, context);
        return reply(await updatePrintJobStatus(env, device, printJobFailed[1], "failed", context, request));
      }

      if (url.pathname === "/api/admin/summary" && request.method === "GET") {
        requireAdmin(request, env, context);
        return reply(await adminSummary(env));
      }

      if (url.pathname === "/api/admin/companies" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_companies_create", 20, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await createCompany(request, env, context));
      }

      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        requireAdmin(request, env, context);
        return reply(await listProducts(env, url));
      }

      if (url.pathname === "/api/admin/products" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_products_create", 60, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await createProduct(request, env, context));
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        requireAdmin(request, env, context);
        return reply(await adminListUsers(env, url));
      }

      const adminUserResetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
      if (adminUserResetMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_users_reset_password", 10, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await adminResetUserPassword(request, env, adminUserResetMatch[1], context));
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "GET") {
        requireAdmin(request, env, context);
        return reply(await adminListPrintJobs(env));
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_print_jobs_create", 60, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await createPrintJob(request, env, context));
      }

      const adminPrintJobReleaseMatch = url.pathname.match(/^\/api\/admin\/print-jobs\/([^/]+)\/release$/);
      if (adminPrintJobReleaseMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_print_jobs_release", 60, 10 * 60);
        requireAdmin(request, env, context);
        return reply(await adminReleasePrintJob(env, adminPrintJobReleaseMatch[1], context));
      }

      return reply(json({ error: "not_found" }, 404));
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
            ? error.status
            : 500;
      if (status !== 500) {
        const payload = buildErrorResponse(error, context.requestId);
        return reply(json(payload, status));
      }

      console.error(JSON.stringify({
        event: "worker.unhandled_error",
        requestId: context.requestId,
        route: context.route,
        error: error instanceof Error ? error.message : String(error)
      }));
      return reply(json(buildInternalErrorResponse(context.requestId), 500));
    }
  }
};

async function checkPrintJobQueueHealth(env: Env): Promise<void> {
  const stalePending = await env.DB.prepare(
    `SELECT company_id, COUNT(*) AS value
     FROM print_jobs
     WHERE status = 'pending'
       AND created_at < datetime('now', '-15 minutes')
     GROUP BY company_id`
  )
    .all<{ company_id: number; value: number }>();

  const expiredPrinting = await env.DB.prepare(
    `SELECT company_id, COUNT(*) AS value
     FROM print_jobs
     WHERE status = 'printing'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < CURRENT_TIMESTAMP
     GROUP BY company_id`
  )
    .all<{ company_id: number; value: number }>();

  for (const row of stalePending.results) {
    console.warn(JSON.stringify({
      event: "print_job.pending_stale",
      companyId: row.company_id,
      count: row.value,
      thresholdMinutes: 15
    }));
  }

  for (const row of expiredPrinting.results) {
    console.warn(JSON.stringify({
      event: "print_job.printing_lease_expired",
      companyId: row.company_id,
      count: row.value
    }));
  }
}

async function registerAccount(request: Request, env: Env): Promise<Response> {
  await purgeExpiredAuthSessions(env);

  const input = parseRegisterAccountBody(await readJson<Record<string, unknown>>(request));

  const account = normalizeAccount(input.account);
  const taxId = input.taxId.trim();
  const phone = normalizeOptionalString(input.phone);
  const address = normalizeOptionalString(input.address);
  const deviceName = normalizeOptionalString(input.deviceName) ?? "iPhone";
  const installationId = normalizeInstallationId(input.installationId);
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
    `INSERT INTO companies (id, name, tax_id, address, amego_app_key_secret_name, amego_app_key, unbind_code)
     VALUES (NULL, ?, ?, ?, NULL, NULL, ?)`
  )
    .bind(input.companyName.trim(), taxId, address, generateUnbindCode())
    .run();
  const companyId = Number(companyResult.meta.last_row_id);

  const passwordHash = await hashPassword(input.password);

  const userResult = await env.DB.prepare(
    `INSERT INTO users (id, company_id, email, password_hash, name, phone, role)
     VALUES (NULL, ?, ?, ?, ?, ?, 'owner')`
  )
    .bind(companyId, account, passwordHash, input.name.trim(), phone)
    .run();
  const userId = Number(userResult.meta.last_row_id);

  const device = await ensureCompanyDevice(env, companyId, deviceName, platform, installationId);
  const sessionToken = await createAuthSession(env, userId, companyId, device.id);

  return jsonAuthPayload({
    authToken: sessionToken,
    user: {
      id: userId,
      name: input.name.trim(),
      account,
      phone,
      role: "owner"
    },
    company: {
      id: companyId,
      name: input.companyName.trim(),
      taxId,
      address,
      hasAppKeyConfigured: false
    },
    device
  });
}

async function loginAccount(request: Request, env: Env, context: RequestContext): Promise<Response> {
  await purgeExpiredAuthSessions(env);

  const input = parseLoginAccountBody(await readJson<Record<string, unknown>>(request));

  const account = normalizeAccount(input.account);
  const row = await env.DB.prepare(
    `SELECT
       u.id,
       u.company_id,
       u.email AS account,
       u.password_hash,
       u.name,
       u.phone,
       u.role,
       c.name AS company_name,
       c.tax_id,
       c.address,
       c.amego_app_key,
       c.unbind_code
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
      role: string | null;
      company_name: string;
      tax_id: string;
      address: string | null;
      amego_app_key: string | null;
      unbind_code: string | null;
    }>();

  if (!row?.company_id || !row.password_hash) {
    throw new HttpError(401, "invalid_credentials");
  }

  context.companyId = row.company_id;
  context.userId = row.id;
  context.actorType = "user";

  const verified = await verifyPassword(input.password, row.password_hash);
  if (!verified) {
    await writeSystemAuditLog(env, {
      companyId: row.company_id,
      actorUserId: row.id,
      targetType: "auth",
      targetId: String(row.id),
      action: "auth.login_failed",
      details: {
        requestId: context.requestId,
        account,
        reason: "invalid_credentials"
      }
    });
    throw new HttpError(401, "invalid_credentials");
  }

  let device: DeviceIdentity;
  try {
    device = await ensureCompanyDevice(
      env,
      row.company_id,
      normalizeOptionalString(input.deviceName) ?? "iPhone",
      normalizeOptionalString(input.platform) ?? "ios",
      normalizeInstallationId(input.installationId),
      normalizeOptionalString(input.unbindCode),
      row.unbind_code
    );
  } catch (error) {
    await writeSystemAuditLog(env, {
      companyId: row.company_id,
      actorUserId: row.id,
      targetType: "auth",
      targetId: String(row.id),
      action: "auth.login_failed",
      details: {
        requestId: context.requestId,
        account,
        reason: error instanceof HttpError ? error.code : "device_binding_error"
      }
    });
    throw error;
  }
  const sessionToken = await createAuthSession(env, row.id, row.company_id, device.id);

  return jsonAuthPayload({
    authToken: sessionToken,
    user: {
      id: row.id,
      name: row.name,
      account: row.account,
      phone: row.phone,
      role: normalizeUserRole(row.role)
    },
    company: {
      id: row.company_id,
      name: row.company_name,
      taxId: row.tax_id,
      address: row.address,
      hasAppKeyConfigured: hasConfiguredAppKey(row.amego_app_key)
    },
    device
  });
}

async function getAuthMe(env: Env, session: UserSession): Promise<Response> {
  const device = session.device_id
    ? await fetchCompanyDeviceById(env, session.company_id, session.device_id)
    : null;
  const resolvedDevice = device ?? await fetchPrimaryCompanyDevice(env, session.company_id);
  if (!resolvedDevice) {
    throw new HttpError(409, "device_not_bound");
  }

  return jsonAuthPayload({
    authToken: session.token,
    user: {
      id: session.user_id,
      name: session.name,
      account: session.account,
      phone: session.phone,
      role: normalizeUserRole(session.role)
    },
    company: {
      id: session.company_id,
      name: session.company_name,
      taxId: session.tax_id,
      address: session.address,
      hasAppKeyConfigured: hasConfiguredAppKey(session.amego_app_key)
    },
    device: {
      id: resolvedDevice.id,
      name: resolvedDevice.name
    }
  });
}

async function logoutAccount(env: Env, session: UserSession): Promise<Response> {
  await env.DB.prepare(
    `UPDATE auth_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE token = ?
       AND revoked_at IS NULL`
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

type SalesSummaryRow = {
  name: string;
  quantity: number | null;
  total: number | null;
};

type SalesInvoiceHeaderRow = {
  invoice_id: string;
  invoice_number: string;
  random_number: string;
  issued_at: string;
  seller_name: string | null;
  seller_identifier: string | null;
  buyer_identifier: string | null;
  total_amount: number;
  print_status: string | null;
};

async function listSalesReport(env: Env, session: UserSession, url: URL): Promise<Response> {
  const startDate = normalizeReportDate(url.searchParams.get("startDate"), "startDate");
  const endDate = normalizeReportDate(url.searchParams.get("endDate"), "endDate");

  if (startDate > endDate) {
    throw new HttpError(400, "date_range_invalid");
  }

  enforceReportDateRange(startDate, endDate);
  const pageLimit = normalizeReportLimit(url.searchParams.get("limit"));
  const cursor = parseSalesReportCursor(url.searchParams.get("cursor"));
  const { startInclusive, endExclusive } = reportDateBounds(startDate, endDate);

  const [invoiceHeadersResult, invoiceItemsResult, productSummaryResult, statusSummaryResult] = await Promise.all([
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       )
       SELECT
         i.id AS invoice_id,
         i.invoice_number,
         i.random_number,
         i.issued_at,
         i.seller_name,
         i.seller_identifier,
         i.buyer_identifier,
         i.total_amount,
         ranked_print_jobs.status AS print_status
       FROM invoices i
       LEFT JOIN ranked_print_jobs
         ON ranked_print_jobs.invoice_id = i.id
        AND ranked_print_jobs.row_number = 1
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
         AND (
           ? IS NULL
           OR i.issued_at < ?
           OR (i.issued_at = ? AND i.id < ?)
         )
       ORDER BY i.issued_at DESC, i.id DESC
       LIMIT ?`
    )
      .bind(
        session.company_id,
        session.company_id,
        startInclusive,
        endExclusive,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.invoiceId ?? null,
        pageLimit
      )
      .all<SalesInvoiceHeaderRow>(),
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       ),
       paged_invoices AS (
         SELECT
           i.id AS invoice_id,
           i.invoice_number,
           i.random_number,
           i.issued_at,
           i.seller_name,
           i.seller_identifier,
           i.buyer_identifier,
           i.total_amount,
           ranked_print_jobs.status AS print_status
         FROM invoices i
         LEFT JOIN ranked_print_jobs
           ON ranked_print_jobs.invoice_id = i.id
          AND ranked_print_jobs.row_number = 1
         WHERE i.company_id = ?
           AND i.issued_at >= ?
           AND i.issued_at < ?
           AND (
             ? IS NULL
             OR i.issued_at < ?
             OR (i.issued_at = ? AND i.id < ?)
           )
         ORDER BY i.issued_at DESC, i.id DESC
         LIMIT ?
       )
       SELECT
         paged_invoices.invoice_id,
         paged_invoices.invoice_number,
         paged_invoices.random_number,
         paged_invoices.issued_at,
         paged_invoices.seller_name,
         paged_invoices.seller_identifier,
         paged_invoices.buyer_identifier,
         paged_invoices.total_amount,
         paged_invoices.print_status,
         ii.id AS item_id,
         ii.name AS item_name,
         ii.quantity AS item_quantity,
         ii.unit_price AS item_unit_price,
         ii.amount AS item_amount
       FROM paged_invoices
       LEFT JOIN invoice_items ii ON ii.invoice_id = paged_invoices.invoice_id
       ORDER BY paged_invoices.issued_at DESC, paged_invoices.invoice_id DESC, ii.rowid ASC`
    )
      .bind(
        session.company_id,
        session.company_id,
        startInclusive,
        endExclusive,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.invoiceId ?? null,
        pageLimit
      )
      .all<SalesInvoiceRow>(),
    env.DB.prepare(
      `SELECT
         ii.name AS name,
         SUM(ii.quantity) AS quantity,
         SUM(ii.amount) AS total
       FROM invoices i
       JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
       GROUP BY ii.name
       ORDER BY total DESC, ii.name ASC`
    )
      .bind(session.company_id, startInclusive, endExclusive)
      .all<SalesSummaryRow>(),
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       )
       SELECT
         COALESCE(ranked_print_jobs.status, 'pending') AS name,
         COUNT(*) AS quantity,
         SUM(i.total_amount) AS total
       FROM invoices i
       LEFT JOIN ranked_print_jobs
         ON ranked_print_jobs.invoice_id = i.id
        AND ranked_print_jobs.row_number = 1
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
       GROUP BY COALESCE(ranked_print_jobs.status, 'pending')
       ORDER BY total DESC, name ASC`
    )
      .bind(session.company_id, session.company_id, startInclusive, endExclusive)
      .all<SalesSummaryRow>()
  ]);

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

  for (const row of invoiceItemsResult.results) {
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

  const headerRows = invoiceHeadersResult.results;
  const nextCursor = headerRows.length < pageLimit
    ? null
    : encodeSalesReportCursor({
        issuedAt: headerRows[headerRows.length - 1].issued_at,
        invoiceId: headerRows[headerRows.length - 1].invoice_id
      });

  return json({
    report: {
      byProduct: productSummaryResult.results.map(mapSalesSummaryRow),
      byStatus: statusSummaryResult.results.map((row) => mapSalesSummaryRow({
        ...row,
        name: salesPrintStatusTitle(row.name)
      })),
      totalQuantity: productSummaryResult.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
      totalAmount: statusSummaryResult.results.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
    },
    invoices: Array.from(invoices.values()),
    nextCursor
  });
}

async function registerDevice(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const input = await readJson<{
    companyId: number | string;
    name: string;
    platform?: string;
  }>(request);

  const companyId = parsePositiveId(input.companyId, "companyId");
  context.companyId = companyId;
  requireString(input.name, "name");

  const id = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);

  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, token_hash, platform)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, input.name, issueDeviceTokenStorageValue(id), tokenHash, input.platform ?? "ios")
    .run();

  await writeSystemAuditLog(env, {
    companyId,
    actorDeviceId: id,
    targetType: "device",
    targetId: id,
    action: "admin.device.register",
    details: {
      requestId: context.requestId,
      name: input.name,
      platform: input.platform ?? "ios"
    }
  });

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

async function listManagedDevices(env: Env, session: UserSession): Promise<Response> {
  requireOwnerAccess(session);

  const result = await env.DB.prepare(
    `SELECT
       id,
       company_id,
       name,
       platform,
       installation_id,
       last_seen_at,
       created_at,
       updated_at
     FROM devices
     WHERE company_id = ?
     ORDER BY created_at ASC`
  )
    .bind(session.company_id)
    .all<ManagedDeviceRow>();

  return json({
    devices: result.results.map(mapManagedDeviceRow)
  });
}

async function createManagedDevice(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireOwnerAccess(session);
  const input = parseManagedDeviceBody(await readJson<Record<string, unknown>>(request));

  const name = normalizeDeviceName(input.name);
  const platform = normalizeDevicePlatform(input.platform);
  const installationId = normalizeOptionalInstallationId(input.installationId);
  const id = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);

  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, session.company_id, name, issueDeviceTokenStorageValue(id), tokenHash, platform, installationId)
    .run();

  const device = await fetchManagedDeviceById(env, session.company_id, id);
  await writeAuditLog(env, session, "device", id, "device.create", {
    name,
    platform,
    installationId
  });

  return json({
    device,
    token
  }, 201);
}

async function updateManagedDevice(
  request: Request,
  env: Env,
  session: UserSession,
  deviceIdValue: string
): Promise<Response> {
  requireOwnerAccess(session);

  const device = await fetchManagedDeviceById(env, session.company_id, deviceIdValue);
  const input = parseManagedDeviceUpdateBody(await readJson<Record<string, unknown>>(request));

  const name = input.name == null ? device.name : normalizeDeviceName(input.name);
  const platform = input.platform == null ? device.platform : normalizeDevicePlatform(input.platform);

  await env.DB.prepare(
    `UPDATE devices
     SET name = ?, platform = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND company_id = ?`
  )
    .bind(name, platform, device.id, session.company_id)
    .run();

  await writeAuditLog(env, session, "device", device.id, "device.update", {
    previousName: device.name,
    nextName: name,
    previousPlatform: device.platform,
    nextPlatform: platform
  });

  return json({
    device: await fetchManagedDeviceById(env, session.company_id, device.id)
  });
}

async function rotateManagedDeviceToken(
  env: Env,
  session: UserSession,
  deviceIdValue: string
): Promise<Response> {
  requireOwnerAccess(session);

  const device = await fetchManagedDeviceById(env, session.company_id, deviceIdValue);
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);

  await env.DB.prepare(
    `UPDATE devices
     SET token = ?, token_hash = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND company_id = ?`
  )
    .bind(issueDeviceTokenStorageValue(device.id), tokenHash, device.id, session.company_id)
    .run();

  await writeAuditLog(env, session, "device", device.id, "device.rotate_token", {
    name: device.name,
    platform: device.platform
  });

  return json({
    device: await fetchManagedDeviceById(env, session.company_id, device.id),
    token
  });
}

async function revokeManagedDevice(
  env: Env,
  session: UserSession,
  deviceIdValue: string
): Promise<Response> {
  requireOwnerAccess(session);

  const device = await fetchManagedDeviceById(env, session.company_id, deviceIdValue);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE company_id = ?
         AND device_id = ?
         AND revoked_at IS NULL`
    ).bind(session.company_id, device.id),
    env.DB.prepare(
      `DELETE FROM devices
       WHERE id = ?
         AND company_id = ?`
    ).bind(device.id, session.company_id)
  ]);

  await writeAuditLog(env, session, "device", device.id, "device.revoke", {
    name: device.name,
    platform: device.platform,
    installationId: device.installation_id
  });

  return json({ ok: true, deviceId: device.id });
}

async function listAuditLogs(env: Env, session: UserSession, url: URL): Promise<Response> {
  requireOwnerAccess(session);

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam == null ? 50 : normalizeAuditLogLimit(limitParam);
  const targetId = normalizeOptionalString(url.searchParams.get("targetId"));

  const statement = targetId
    ? env.DB.prepare(
        `SELECT
           a.id,
           a.company_id,
           a.actor_user_id,
           u.name AS actor_name,
           u.email AS actor_account,
           a.actor_device_id,
           a.target_type,
           a.target_id,
           a.action,
           a.details_json,
           a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.company_id = ?
           AND a.target_id = ?
         ORDER BY a.created_at DESC
         LIMIT ?`
      ).bind(session.company_id, targetId, limit)
    : env.DB.prepare(
        `SELECT
           a.id,
           a.company_id,
           a.actor_user_id,
           u.name AS actor_name,
           u.email AS actor_account,
           a.actor_device_id,
           a.target_type,
           a.target_id,
           a.action,
           a.details_json,
           a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.company_id = ?
         ORDER BY a.created_at DESC
         LIMIT ?`
      ).bind(session.company_id, limit);

  const result = await statement.all<AuditLogRow>();

  return json({
    logs: result.results.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorAccount: row.actor_account,
      actorDeviceId: row.actor_device_id,
      targetType: row.target_type,
      targetId: row.target_id,
      action: row.action,
      details: parseOptionalJson(row.details_json),
      createdAt: row.created_at
    }))
  });
}

async function listPendingPrintJobs(env: Env, device: DeviceSession, context: RequestContext): Promise<Response> {
  const leaseExpiry = leaseExpiryTimestamp();

  const claimResult = await env.DB.prepare(
    `UPDATE print_jobs
     SET
       status = 'printing',
       claimed_by = ?,
       claimed_at = CURRENT_TIMESTAMP,
       lease_expires_at = ?,
       attempt_count = COALESCE(attempt_count, 0) + 1,
       updated_at = CURRENT_TIMESTAMP
     WHERE id IN (
       SELECT id
       FROM print_jobs
       WHERE company_id = ?
         AND (device_id IS NULL OR device_id = ?)
         AND (
           status = 'pending'
           OR (status = 'printing' AND lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP)
         )
       ORDER BY created_at ASC
       LIMIT 50
     )`
  )
    .bind(device.id, leaseExpiry, device.company_id, device.id)
    .run();

  const result = await env.DB.prepare(
    `SELECT id, payload_json, status, created_at, claimed_by, claimed_at, lease_expires_at, attempt_count
     FROM print_jobs
     WHERE company_id = ?
       AND status = 'printing'
       AND claimed_by = ?
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at >= CURRENT_TIMESTAMP
     ORDER BY created_at ASC
     LIMIT 50`
  )
    .bind(device.company_id, device.id)
    .all<PrintJobRow>();

  if (claimResult.meta.changes > 0) {
    await writeSystemAuditLog(env, {
      companyId: device.company_id,
      actorDeviceId: device.id,
      targetType: "print_job_batch",
      targetId: device.id,
      action: "print_job.claim",
      details: {
        requestId: context.requestId,
        claimedCount: claimResult.meta.changes,
        leaseExpiresAt: leaseExpiry
      }
    });
  }

  return json({
    jobs: result.results.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      leaseExpiresAt: row.lease_expires_at,
      attemptCount: row.attempt_count ?? 0,
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

async function listCatalogCategories(env: Env, session: UserSession): Promise<Response> {
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
    .bind(session.company_id)
    .all<CatalogCategoryRow>();

  return json({
    categories: result.results.map(mapCatalogCategoryRow)
  });
}

async function createCatalogCategory(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireCatalogWriteAccess(session);
  const input = parseCatalogCategoryBody(await readJson<Record<string, unknown>>(request));
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO categories (id, company_id, name, sort_order, status)
     VALUES (NULL, ?, ?, ?, ?)`
  )
    .bind(session.company_id, input.name.trim(), sortOrder, status)
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
  session: UserSession,
  categoryIdValue: string
): Promise<Response> {
  requireCatalogWriteAccess(session);
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const input = parseCatalogCategoryBody(await readJson<Record<string, unknown>>(request));
  const status = normalizeStatus(input.status);
  const sortOrder = normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `UPDATE categories
     SET name = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  )
    .bind(input.name.trim(), sortOrder, status, categoryId, session.company_id)
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

async function deleteCatalogCategory(env: Env, session: UserSession, categoryIdValue: string): Promise<Response> {
  requireCatalogWriteAccess(session);
  const categoryId = parsePositiveId(categoryIdValue, "categoryId");
  const result = await env.DB.prepare(
    `DELETE FROM categories
     WHERE id = ? AND company_id = ?`
  )
    .bind(categoryId, session.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "category_not_found");
  }

  return json({ ok: true });
}

async function listCatalogProducts(env: Env, session: UserSession): Promise<Response> {
  const priceDecimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
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
    .bind(session.company_id)
    .all<CatalogProductRow>();

  return json({
    priceDecimalPlaces,
    products: result.results.map(mapCatalogProductRow)
  });
}

async function createCatalogProduct(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireCatalogWriteAccess(session);
  const input = parseCatalogProductBody(await readJson<Record<string, unknown>>(request));
  const normalizedCategoryId = await validateCategoryId(env, session.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
  const sortOrder = input.sortOrder == null
    ? await nextProductSortOrder(env, session.company_id)
    : normalizeSortOrder(input.sortOrder);

  const result = await env.DB.prepare(
    `INSERT INTO products (id, company_id, category_id, name, price, decimal_places, image_path, is_active, tax_type, sort_order)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      session.company_id,
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
    product: await fetchCatalogProductById(env, session.company_id, id)
  }, 201);
}

async function updateCatalogProduct(
  request: Request,
  env: Env,
  session: UserSession,
  productIdValue: string
): Promise<Response> {
  requireCatalogWriteAccess(session);
  const productId = parsePositiveId(productIdValue, "productId");
  const input = parseCatalogProductBody(await readJson<Record<string, unknown>>(request));
  const normalizedCategoryId = await validateCategoryId(env, session.company_id, input.categoryId ?? null);
  const status = normalizeStatus(input.status);
  const taxType = normalizeTaxType(input.taxType);
  const decimalPlaces = await fetchCompanyPriceDecimalPlaces(env, session.company_id);
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
      session.company_id
    )
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({
    product: await fetchCatalogProductById(env, session.company_id, productId)
  });
}

async function updateCatalogSettings(request: Request, env: Env, session: UserSession): Promise<Response> {
  requireOwnerAccess(session);
  const input = await readJson<{ priceDecimalPlaces?: number }>(request);
  const nextValue = normalizeDecimalPlaces(input.priceDecimalPlaces);
  const currentValue = await fetchCompanyPriceDecimalPlaces(env, session.company_id);

  if (nextValue !== currentValue) {
    if (nextValue > currentValue) {
      const multiplier = integerPower10(nextValue - currentValue);
      await env.DB.prepare(
        `UPDATE products
         SET price = price * ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ?`
      )
        .bind(multiplier, nextValue, session.company_id)
        .run();
    } else {
      const divisor = integerPower10(currentValue - nextValue);
      const precisionLoss = await env.DB.prepare(
        `SELECT COUNT(*) AS value
         FROM products
         WHERE company_id = ?
           AND (price % ?) != 0`
      )
        .bind(session.company_id, divisor)
        .first<{ value: number | null }>();

      if (Number(precisionLoss?.value ?? 0) > 0) {
        throw new HttpError(400, "目前商品價格含有更細的小數，不能直接降低小數位數。");
      }

      await env.DB.prepare(
        `UPDATE products
         SET price = price / ?, decimal_places = ?, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ?`
      )
        .bind(divisor, nextValue, session.company_id)
        .run();
    }

    await env.DB.prepare(
      `UPDATE companies
       SET price_decimal_places = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(nextValue, session.company_id)
      .run();
  }

  return json({ priceDecimalPlaces: nextValue });
}

async function deleteCatalogProduct(env: Env, session: UserSession, productIdValue: string): Promise<Response> {
  requireCatalogWriteAccess(session);
  const productId = parsePositiveId(productIdValue, "productId");
  const result = await env.DB.prepare(
    `DELETE FROM products
     WHERE id = ? AND company_id = ?`
  )
    .bind(productId, session.company_id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "product_not_found");
  }

  return json({ ok: true });
}

async function getPrintJob(env: Env, device: DeviceSession, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, payload_json, status, created_at, claimed_by, claimed_at, lease_expires_at, attempt_count
     FROM print_jobs
     WHERE id = ?
       AND company_id = ?
       AND claimed_by = ?
       AND status = 'printing'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at >= CURRENT_TIMESTAMP`
  )
    .bind(id, device.company_id, device.id)
    .first<PrintJobRow>();

  if (!row) {
    throw new HttpError(404, "print_job_not_found");
  }

  return json({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count ?? 0,
    payload: parsePayload(row.payload_json)
  });
}

async function updatePrintJobStatus(
  env: Env,
  device: DeviceSession,
  id: string,
  status: "printed" | "failed",
  context: RequestContext,
  request?: Request
): Promise<Response> {
  const input: { message?: string } = request
    ? parsePrintJobStatusBody(await readJson<Record<string, unknown>>(request))
    : {};
  const message = input.message ?? null;
  const printedAt = status === "printed" ? new Date().toISOString() : null;

  const row = await env.DB.prepare(
    `SELECT status, claimed_by, lease_expires_at
     FROM print_jobs
     WHERE id = ?
       AND company_id = ?`
  )
    .bind(id, device.company_id)
    .first<{ status: string; claimed_by: string | null; lease_expires_at: string | null }>();

  if (!row) {
    throw new HttpError(404, "print_job_not_found");
  }

  if (row.claimed_by !== device.id) {
    throw new HttpError(409, "print_job_not_claimed_by_device");
  }

  if (row.status === status) {
    return json({ ok: true, idempotent: true });
  }

  if (row.status === "printed" || row.status === "failed") {
    throw new HttpError(409, "print_job_already_finalized");
  }

  if (row.status !== "printing") {
    throw new HttpError(409, "print_job_not_in_progress");
  }

  if (!row.lease_expires_at || row.lease_expires_at < new Date().toISOString().slice(0, 19).replace("T", " ")) {
    throw new HttpError(409, "print_job_claim_expired");
  }

  const result = await env.DB.prepare(
    `UPDATE print_jobs
     SET
       status = ?,
       last_error = ?,
       printed_at = COALESCE(?, printed_at),
       lease_expires_at = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND company_id = ?
       AND status = 'printing'
       AND claimed_by = ?`
  )
    .bind(status, status === "failed" ? message : null, printedAt, id, device.company_id, device.id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(409, "print_job_update_conflict");
  }

  await env.DB.prepare(
    `INSERT INTO print_logs (id, print_job_id, device_id, status, message)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), id, device.id, status, message)
    .run();

  await writeSystemAuditLog(env, {
    companyId: device.company_id,
    actorDeviceId: device.id,
    targetType: "print_job",
    targetId: id,
    action: status === "printed" ? "print_job.printed" : "print_job.failed",
    details: {
      requestId: context.requestId,
      previousStatus: row.status,
      message: status === "failed" ? message : undefined
    }
  });

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

async function createCompany(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const input = await readJson<{ name: string; taxId: string; appKey?: string }>(request);
  requireString(input.name, "name");
  requireString(input.taxId, "taxId");
  const appKey = normalizeOptionalBoundedString(input.appKey, 255);
  const unbindCode = generateUnbindCode();

  const companyResult = await env.DB.prepare(
    `INSERT INTO companies (id, name, tax_id, amego_app_key_secret_name, amego_app_key, unbind_code)
     VALUES (NULL, ?, ?, NULL, ?, ?)`
  )
    .bind(input.name, input.taxId, appKey, unbindCode)
    .run();

  const companyId = Number(companyResult.meta.last_row_id);
  context.companyId = companyId;
  await writeSystemAuditLog(env, {
    companyId,
    targetType: "company",
    targetId: String(companyId),
    action: "admin.company.create",
    details: {
      requestId: context.requestId,
      taxId: input.taxId,
      hasAppKey: hasConfiguredAppKey(appKey)
    }
  });

  return json({ id: companyId, unbindCode });
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

async function createProduct(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const input = parseAdminProductBody(await readJson<Record<string, unknown>>(request));

  const companyId = parsePositiveId(input.companyId, "companyId");
  context.companyId = companyId;
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

  const productId = Number(result.meta.last_row_id);
  await writeSystemAuditLog(env, {
    companyId,
    targetType: "product",
    targetId: String(productId),
    action: "admin.product.create",
    details: {
      requestId: context.requestId,
      categoryId: normalizedCategoryId,
      price: input.price,
      status,
      taxType
    }
  });

  return json({ id: productId });
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
           u.role,
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
           u.role,
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
      role: normalizeUserRole(row.role),
      createdAt: row.created_at
    }))
  });
}

async function adminResetUserPassword(
  request: Request,
  env: Env,
  userIdValue: string,
  context: RequestContext
): Promise<Response> {
  await purgeExpiredAuthSessions(env);

  const userId = parsePositiveId(userIdValue, "userId");
  const input = parseResetPasswordBody(await readJson<Record<string, unknown>>(request));
  requirePassword(input.password);

  const passwordHash = await hashPassword(input.password);
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(passwordHash, userId),
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND revoked_at IS NULL`
    ).bind(userId)
  ]);

  if (result.meta.changes === 0) {
    throw new HttpError(404, "user_not_found");
  }

  const user = await env.DB.prepare(
    `SELECT company_id
     FROM users
     WHERE id = ?`
  )
    .bind(userId)
    .first<{ company_id: number | null }>();
  context.companyId = user?.company_id ?? context.companyId;
  await writeSystemAuditLog(env, {
    companyId: user?.company_id ?? 0,
    targetType: "user",
    targetId: String(userId),
    action: "admin.user.reset_password",
    details: {
      requestId: context.requestId,
      revokedSessions: true
    }
  });

  return json({ ok: true, userId });
}

async function adminListPrintJobs(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, company_id, device_id, status, payload_json, last_error, printed_at, created_at,
            claimed_by, claimed_at, lease_expires_at, attempt_count
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
      claimed_by: string | null;
      claimed_at: string | null;
      lease_expires_at: string | null;
      attempt_count: number | null;
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
      createdAt: row.created_at,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      leaseExpiresAt: row.lease_expires_at,
      attemptCount: row.attempt_count ?? 0
    }))
  });
}

async function adminReleasePrintJob(env: Env, id: string, context: RequestContext): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT company_id, claimed_by, status
     FROM print_jobs
     WHERE id = ?`
  )
    .bind(id)
    .first<{ company_id: number; claimed_by: string | null; status: string }>();
  context.companyId = row?.company_id ?? context.companyId;

  const result = await env.DB.prepare(
    `UPDATE print_jobs
     SET
       status = 'pending',
       claimed_by = NULL,
       claimed_at = NULL,
       lease_expires_at = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'printing'`
  )
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    throw new HttpError(404, "print_job_not_releasable");
  }

  await env.DB.prepare(
    `INSERT INTO print_logs (id, print_job_id, device_id, status, message)
     VALUES (?, ?, NULL, 'pending', 'released_by_admin')`
  )
    .bind(crypto.randomUUID(), id)
    .run();

  if (row) {
    await writeSystemAuditLog(env, {
      companyId: row.company_id,
      actorDeviceId: row.claimed_by,
      targetType: "print_job",
      targetId: id,
      action: "admin.print_job.release",
      details: {
        requestId: context.requestId,
        previousStatus: row.status
      }
    });
  }

  return json({ ok: true });
}

async function createPrintJob(request: Request, env: Env, context: RequestContext): Promise<Response> {
  const input = parseCreatePrintJobBody(await readJson<Record<string, unknown>>(request));

  const companyId = parsePositiveId(input.companyId, "companyId");
  context.companyId = companyId;
  const invoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
  const randomNumber = normalizeRandomNumber(input.randomNumber);
  const sellerIdentifier = normalizeCompanyIdentifier(input.sellerIdentifier, "sellerIdentifier");
  const buyerIdentifier = normalizeOptionalCompanyIdentifier(input.buyerIdentifier, "buyerIdentifier");
  const sellerName = normalizeOptionalBoundedString(input.sellerName, 100);
  const qrCodePayload = normalizeOptionalBoundedString(input.qrCodePayload, 4096);
  const barcodePayload = normalizeOptionalBoundedString(input.barcodePayload, 64);
  requireNonNegativeInteger(input.totalAmount, "totalAmount");
  requireArray(input.items, "items", { min: 1, max: 200 });

  const invoiceId = crypto.randomUUID();
  const issuedAt = normalizeIssuedAt(input.issuedAt);
  const idempotencyKey = await buildPrintJobIdempotencyKey(request, {
    companyId,
    inputKey: input.idempotencyKey,
    invoiceNumber,
    randomNumber,
    issuedAt,
    sellerIdentifier,
    buyerIdentifier,
    totalAmount: input.totalAmount,
    items: input.items,
    qrCodePayload,
    barcodePayload: barcodePayload ?? invoiceNumber
  });

  const existingJob = await findExistingPrintJobByIdempotencyKey(env, companyId, idempotencyKey);
  if (existingJob) {
    console.warn(JSON.stringify({
      event: "print_job.idempotent_replay",
      requestId: context.requestId,
      companyId,
      printJobId: existingJob.id,
      invoiceId: existingJob.invoiceId
    }));
    await writeSystemAuditLog(env, {
      companyId,
      targetType: "print_job",
      targetId: existingJob.id,
      action: "admin.print_job.idempotent_replay",
      details: {
        requestId: context.requestId,
        invoiceId: existingJob.invoiceId
      }
    });
    return json(existingJob);
  }

  const existingInvoice = await findExistingInvoiceByNumber(env, companyId, invoiceNumber);
  if (existingInvoice) {
    throw new HttpError(409, "invoice_number_exists");
  }

  const normalizedDeviceId = await validateDeviceOwnership(env, companyId, input.deviceId ?? null);

  const items = input.items.map((item) => {
    const name = normalizeRequiredBoundedString(item.name, "item.name", 100);
    requireStrictPositiveInteger(item.quantity, "item.quantity");
    requireNonNegativeInteger(item.unitPrice, "item.unitPrice");
    return {
      id: crypto.randomUUID(),
      name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice
    };
  });

  const calculatedTotalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (calculatedTotalAmount !== input.totalAmount) {
    throw new HttpError(400, "total_amount_mismatch");
  }

  const jobId = crypto.randomUUID();
  const payload: PrintJobPayload = {
    remoteId: jobId,
    invoiceNumber,
    randomNumber,
    issuedAt,
    sellerName: sellerName ?? undefined,
    sellerIdentifier,
    buyerIdentifier: buyerIdentifier ?? undefined,
    totalAmount: input.totalAmount,
    items: items.map(({ id, name, quantity, unitPrice }) => ({ id, name, quantity, unitPrice })),
    qrCodePayload: qrCodePayload ?? undefined,
    barcodePayload: barcodePayload ?? invoiceNumber
  };

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO invoices (
           id, company_id, invoice_number, random_number, issued_at,
           seller_name, seller_identifier, buyer_identifier, total_amount
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        invoiceId,
        companyId,
        invoiceNumber,
        randomNumber,
        issuedAt,
        sellerName,
        sellerIdentifier,
        buyerIdentifier,
        input.totalAmount
      ),
      ...items.map((item) =>
        env.DB.prepare(
          `INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(item.id, invoiceId, item.name, item.quantity, item.unitPrice, item.amount)
      ),
      env.DB.prepare(
        `INSERT INTO print_jobs (id, company_id, device_id, invoice_id, payload_json, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(jobId, companyId, normalizedDeviceId, invoiceId, JSON.stringify(payload), idempotencyKey)
    ]);
  } catch (error) {
    const recoveredJob = await findExistingPrintJobByIdempotencyKey(env, companyId, idempotencyKey);
    if (recoveredJob) {
      return json(recoveredJob);
    }
    throw error;
  }

  await writeSystemAuditLog(env, {
    companyId,
    actorDeviceId: normalizedDeviceId,
    targetType: "print_job",
    targetId: jobId,
    action: "admin.print_job.create",
    details: {
      requestId: context.requestId,
      invoiceId,
      itemCount: items.length,
      totalAmount: input.totalAmount,
      hasBuyerIdentifier: buyerIdentifier != null
    }
  });

  return json({ id: jobId, invoiceId, payload });
}

async function requireDevice(request: Request, env: Env, context?: RequestContext): Promise<DeviceSession> {
  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "missing_device_token");
  }

  const tokenHash = await hashDeviceToken(token);

  const device = await env.DB.prepare(
    `SELECT id, company_id, name
     FROM devices
     WHERE token_hash = ?
        OR token = ?`
  )
    .bind(tokenHash, token)
    .first<DeviceSession>();

  if (!device) {
    throw new HttpError(401, "invalid_device_token");
  }

  if (context) {
    context.companyId = device.company_id;
    context.deviceId = device.id;
    context.actorType = "device";
  }

  await upgradeLegacyDeviceTokenIfNeeded(env, device.id, token, tokenHash);

  await env.DB.prepare(
    `UPDATE devices
     SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(device.id)
    .run();

  return device;
}

async function requireUserSession(request: Request, env: Env, context?: RequestContext): Promise<UserSession> {
  await purgeExpiredAuthSessions(env);

  const token = bearerToken(request);
  if (!token) {
    throw new HttpError(401, "missing_auth_token");
  }

  const session = await env.DB.prepare(
    `SELECT
       s.token,
       s.user_id,
       s.company_id,
       s.device_id,
       u.name,
       u.email AS account,
       u.phone,
       u.role,
       c.name AS company_name,
       c.tax_id,
       c.address,
       c.amego_app_key
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.id = s.company_id
     WHERE s.token = ?
       AND s.revoked_at IS NULL
       AND s.expires_at IS NOT NULL
       AND s.expires_at > CURRENT_TIMESTAMP`
  )
    .bind(token)
    .first<UserSession>();

  if (!session) {
    throw new HttpError(401, "invalid_auth_token");
  }

  if (context) {
    context.companyId = session.company_id;
    context.userId = session.user_id;
    context.deviceId = session.device_id ?? undefined;
    context.actorType = "user";
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

function requireAdmin(request: Request, env: Env, context?: RequestContext): void {
  const configuredToken = env.ADMIN_TOKEN;
  if (!configuredToken) {
    throw new HttpError(500, "admin_token_not_configured");
  }

  if (bearerToken(request) !== configuredToken) {
    throw new HttpError(401, "invalid_admin_token");
  }

  if (context) {
    context.actorType = "admin";
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip")?.trim();
  if (forwarded) {
    return forwarded;
  }

  const realIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

async function enforceRateLimit(
  request: Request,
  env: Env,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const identifier = clientIdentifier(request);
  const nowEpoch = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(
    `INSERT INTO request_rate_limits (
       scope,
       identifier,
       window_started_at,
       request_count,
       updated_at
     )
     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(scope, identifier) DO UPDATE SET
       request_count = CASE
         WHEN request_rate_limits.window_started_at <= excluded.window_started_at - ?
           THEN 1
         ELSE request_rate_limits.request_count + 1
       END,
       window_started_at = CASE
         WHEN request_rate_limits.window_started_at <= excluded.window_started_at - ?
           THEN excluded.window_started_at
         ELSE request_rate_limits.window_started_at
       END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING request_count, window_started_at`
  )
    .bind(scope, identifier, nowEpoch, windowSeconds, windowSeconds)
    .first<{ request_count: number; window_started_at: number }>();

  if (!result) {
    throw new HttpError(500, "rate_limit_unavailable");
  }

  if (result.request_count > limit) {
    throw new HttpError(429, "too_many_requests");
  }

  if (Math.random() < 0.02) {
    await env.DB.prepare(
      `DELETE FROM request_rate_limits
       WHERE updated_at < datetime('now', '-2 days')`
    ).run();
  }
}

async function findExistingPrintJobByIdempotencyKey(
  env: Env,
  companyId: number,
  idempotencyKey: string
): Promise<{ id: string; invoiceId: string | null; payload: PrintJobPayload } | null> {
  const row = await env.DB.prepare(
    `SELECT id, invoice_id, payload_json
     FROM print_jobs
     WHERE company_id = ?
       AND idempotency_key = ?`
  )
    .bind(companyId, idempotencyKey)
    .first<{ id: string; invoice_id: string | null; payload_json: string }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    invoiceId: row.invoice_id,
    payload: parsePayload(row.payload_json)
  };
}

async function findExistingInvoiceByNumber(
  env: Env,
  companyId: number,
  invoiceNumber: string
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT id
     FROM invoices
     WHERE company_id = ?
       AND invoice_number = ?`
  )
    .bind(companyId, invoiceNumber)
    .first<{ id: string }>();
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

function mapManagedDeviceRow(row: ManagedDeviceRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    platform: row.platform,
    installationId: row.installation_id,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSalesSummaryRow(row: SalesSummaryRow) {
  return {
    name: row.name,
    quantity: Number(row.quantity ?? 0),
    total: Number(row.total ?? 0)
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

async function validateDeviceOwnership(
  env: Env,
  companyId: number,
  deviceId: string | null
): Promise<string | null> {
  if (!deviceId) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT id
     FROM devices
     WHERE id = ?
       AND company_id = ?`
  )
    .bind(deviceId, companyId)
    .first<{ id: string }>();

  if (!row) {
    throw new HttpError(400, "invalid_device_id");
  }

  return row.id;
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

async function fetchManagedDeviceById(env: Env, companyId: number, deviceId: string): Promise<ManagedDeviceRow> {
  const row = await env.DB.prepare(
    `SELECT
       id,
       company_id,
       name,
       platform,
       installation_id,
       last_seen_at,
       created_at,
       updated_at
     FROM devices
     WHERE id = ?
       AND company_id = ?`
  )
    .bind(deviceId, companyId)
    .first<ManagedDeviceRow>();

  if (!row) {
    throw new HttpError(404, "device_not_found");
  }

  return row;
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

function normalizeDeviceName(value: unknown): string {
  return normalizeRequiredBoundedString(value, "name", 60);
}

function normalizeDevicePlatform(value: unknown): string {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? "ios";
  return normalized === "" ? "ios" : normalizeRequiredBoundedString(normalized, "platform", 20).toLowerCase();
}

function hasConfiguredAppKey(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function normalizeInstallationId(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "installationId", 64);
  if (!/^[A-Za-z0-9-]+$/.test(normalized)) {
    throw new HttpError(400, "installationId_invalid");
  }
  return normalized;
}

function normalizeOptionalInstallationId(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = normalizeOptionalString(value);
  return normalized == null ? null : normalizeInstallationId(normalized);
}

function generateUnbindCode(): string {
  return Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0");
}

function normalizeRequiredBoundedString(value: unknown, field: string, maxLength: number): string {
  requireString(value, field);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field}_too_long`);
  }
  return normalized;
}

function normalizeOptionalBoundedString(value: unknown, maxLength: number): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, "string_too_long");
  }
  return normalized;
}

function normalizeInvoiceNumber(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "invoiceNumber", 10).toUpperCase();
  if (!/^[A-Z]{2}\d{8}$/.test(normalized)) {
    throw new HttpError(400, "invoiceNumber_invalid");
  }
  return normalized;
}

function normalizeRandomNumber(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "randomNumber", 4);
  if (!/^\d{4}$/.test(normalized)) {
    throw new HttpError(400, "randomNumber_invalid");
  }
  return normalized;
}

function normalizeCompanyIdentifier(value: unknown, field: string): string {
  const normalized = normalizeRequiredBoundedString(value, field, 8);
  if (!/^\d{8}$/.test(normalized)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return normalized;
}

function normalizeOptionalCompanyIdentifier(value: unknown, field: string): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return null;
  }
  if (!/^\d{8}$/.test(normalized)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return normalized;
}

function normalizeIssuedAt(value: unknown): string {
  if (value == null) {
    return new Date().toISOString();
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "issuedAt_invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "issuedAt_invalid");
  }
  return parsed.toISOString();
}

async function buildPrintJobIdempotencyKey(
  request: Request,
  input: {
    companyId: number;
    inputKey?: string;
    invoiceNumber: string;
    randomNumber: string;
    issuedAt: string;
    sellerIdentifier: string;
    buyerIdentifier: string | null;
    totalAmount: number;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    qrCodePayload: string | null;
    barcodePayload: string;
  }
): Promise<string> {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const explicitKey = typeof input.inputKey === "string" ? input.inputKey.trim() : "";
  const providedKey = headerKey || explicitKey;
  if (providedKey) {
    if (providedKey.length > 128) {
      throw new HttpError(400, "idempotency_key_too_long");
    }
    return `${input.companyId}:manual:${await sha256Hex(providedKey)}`;
  }

  const fingerprint = JSON.stringify({
    invoiceNumber: input.invoiceNumber,
    randomNumber: input.randomNumber,
    issuedAt: input.issuedAt,
    sellerIdentifier: input.sellerIdentifier,
    buyerIdentifier: input.buyerIdentifier,
    totalAmount: input.totalAmount,
    items: input.items.map((item) => ({
      name: typeof item.name === "string" ? item.name.trim() : item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })),
    qrCodePayload: input.qrCodePayload,
    barcodePayload: input.barcodePayload
  });
  return `${input.companyId}:auto:${await sha256Hex(fingerprint)}`;
}

function normalizeReportDate(value: string | null, field: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return value;
}

function normalizeReportLimit(value: string | null): number {
  if (value == null) {
    return 100;
  }

  if (!/^\d+$/.test(value.trim())) {
    throw new HttpError(400, "report_limit_invalid");
  }

  const numeric = Number(value.trim());
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new HttpError(400, "report_limit_invalid");
  }

  return numeric;
}

function reportDateBounds(startDate: string, endDate: string) {
  const startInclusive = `${startDate}T00:00:00.000Z`;
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endExclusive = end.toISOString();
  return { startInclusive, endExclusive };
}

function parseSalesReportCursor(value: string | null): { issuedAt: string; invoiceId: string } | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(value)) as { issuedAt?: unknown; invoiceId?: unknown };
    if (typeof decoded.issuedAt !== "string" || decoded.issuedAt.trim() === "") {
      throw new HttpError(400, "report_cursor_invalid");
    }
    if (typeof decoded.invoiceId !== "string" || decoded.invoiceId.trim() === "") {
      throw new HttpError(400, "report_cursor_invalid");
    }
    return {
      issuedAt: decoded.issuedAt,
      invoiceId: decoded.invoiceId
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "report_cursor_invalid");
  }
}

function encodeSalesReportCursor(input: { issuedAt: string; invoiceId: string }): string {
  return btoa(JSON.stringify(input));
}

function normalizeStatus(value: unknown): string {
  if (value == null) {
    return "顯示";
  }
  if (value === "顯示" || value === "隱藏") {
    return value;
  }
  throw new HttpError(400, "status_invalid");
}

function normalizeUserRole(value: unknown): "owner" | "staff" {
  return value === "owner" ? "owner" : "staff";
}

function normalizeAuditLogLimit(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new HttpError(400, "limit_invalid");
  }
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new HttpError(400, "limit_invalid");
  }
  return numeric;
}

function normalizePrintStatusValue(value: unknown): string {
  return value === "printed" || value === "failed" || value === "printing" ? value : "pending";
}

function salesPrintStatusTitle(value: string): string {
  switch (value) {
    case "printing":
      return "傳送中";
    case "printed":
      return "已列印";
    case "failed":
      return "列印失敗";
    default:
      return "待列印";
  }
}

function normalizeTaxType(value: unknown): string {
  if (value == null) {
    return "含稅";
  }
  if (value === "含稅" || value === "未稅") {
    return value;
  }
  throw new HttpError(400, "tax_type_invalid");
}

function normalizeSortOrder(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "sort_order_invalid");
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

function enforceReportDateRange(startDate: string, endDate: string): void {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    throw new HttpError(400, "date_range_invalid");
  }
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays > MAX_REPORT_RANGE_DAYS) {
    throw new HttpError(400, "date_range_too_large");
  }
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

function issueDeviceTokenStorageValue(deviceId: string): string {
  return `stored:${deviceId}`;
}

function authSessionExpiryTimestamp(days = AUTH_SESSION_DURATION_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

function leaseExpiryTimestamp(minutes = 5): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

async function createAuthSession(env: Env, userId: number, companyId: number, deviceId: string | null): Promise<string> {
  const token = generateSessionToken();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token, user_id, company_id, device_id, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
  )
    .bind(token, userId, companyId, deviceId, authSessionExpiryTimestamp())
    .run();
  return token;
}

function requireCatalogWriteAccess(session: UserSession): void {
  const role = normalizeUserRole(session.role);
  if (role !== "owner" && role !== "staff") {
    throw new HttpError(403, "forbidden");
  }
}

function requireOwnerAccess(session: UserSession): void {
  if (normalizeUserRole(session.role) !== "owner") {
    throw new HttpError(403, "owner_required");
  }
}

async function purgeExpiredAuthSessions(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM auth_sessions
     WHERE revoked_at IS NOT NULL
        OR expires_at IS NULL
        OR expires_at <= CURRENT_TIMESTAMP`
  ).run();
}

async function upgradeLegacyDeviceTokenIfNeeded(
  env: Env,
  deviceId: string,
  rawToken: string,
  tokenHash: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE devices
     SET token_hash = ?, token = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (token_hash IS NULL OR trim(token_hash) = '')
       AND token = ?`
  )
    .bind(tokenHash, issueDeviceTokenStorageValue(deviceId), deviceId, rawToken)
    .run();
}

async function writeAuditLog(
  env: Env,
  session: UserSession,
  targetType: string,
  targetId: string,
  action: string,
  details: Record<string, unknown> | null = null
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (
       id,
       company_id,
       actor_user_id,
       actor_device_id,
       target_type,
       target_id,
       action,
       details_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      session.company_id,
      session.user_id,
      session.device_id,
      targetType,
      targetId,
      action,
      details == null ? null : JSON.stringify(details)
    )
    .run();
}

async function writeSystemAuditLog(
  env: Env,
  input: {
    companyId: number;
    actorUserId?: number | null;
    actorDeviceId?: string | null;
    targetType: string;
    targetId: string;
    action: string;
    details?: Record<string, unknown> | null;
  }
): Promise<void> {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    return;
  }

  await env.DB.prepare(
    `INSERT INTO audit_logs (
       id,
       company_id,
       actor_user_id,
       actor_device_id,
       target_type,
       target_id,
       action,
       details_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      input.companyId,
      input.actorUserId ?? null,
      input.actorDeviceId ?? null,
      input.targetType,
      input.targetId,
      input.action,
      input.details == null ? null : JSON.stringify(sanitizeAuditDetails(input.details))
    )
    .run();
}

function sanitizeAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizeAuditValue(key, value)])
  );
}

function sanitizeAuditValue(key: string, value: unknown): unknown {
  const lowered = key.toLowerCase();
  if (lowered.includes("token") || lowered.includes("password") || lowered.includes("payload")) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  if (value && typeof value === "object") {
    return "[object]";
  }
  return value;
}

async function hashDeviceToken(token: string): Promise<string> {
  return sha256Hex(`device:${token}`);
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

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  platform: string,
  installationId: string,
  unbindCode?: string | null,
  expectedUnbindCode?: string | null
) {
  const existing = await env.DB.prepare(
    `SELECT d.id, d.name
     FROM devices d
     WHERE d.company_id = ?
       AND d.installation_id = ?
     ORDER BY d.created_at ASC
     LIMIT 1`
  )
    .bind(companyId, installationId)
    .first<{
      id: string;
      name: string;
    }>();

  if (existing) {
    const token = generateSessionToken();
    const tokenHash = await hashDeviceToken(token);
    await env.DB.prepare(
      `UPDATE devices
       SET token = ?, token_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(issueDeviceTokenStorageValue(existing.id), tokenHash, existing.id)
      .run();

    return {
      id: existing.id,
      name: existing.name,
      token
    };
  }

  const existingCompanyDevice = await fetchPrimaryCompanyDevice(env, companyId, false);
  if (existingCompanyDevice) {
    const companyUnbindCode = expectedUnbindCode ?? await fetchCompanyUnbindCode(env, companyId);
    if (!companyUnbindCode || unbindCode?.trim() !== companyUnbindCode) {
      throw new HttpError(409, "device_binding_locked");
    }

    await releaseCompanyDevices(env, companyId);
  }

  const id = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);
  await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, companyId, deviceName, issueDeviceTokenStorageValue(id), tokenHash, platform, installationId)
    .run();

  return {
    id,
    token,
    name: deviceName
  };
}

async function fetchPrimaryCompanyDevice(env: Env, companyId: number, createIfMissing = true) {
  const device = await env.DB.prepare(
    `SELECT d.id, d.name
     FROM devices d
     WHERE d.company_id = ?
     ORDER BY d.created_at ASC
     LIMIT 1`
  )
    .bind(companyId)
    .first<{
      id: string;
      name: string;
    }>();

  if (device) {
    return {
      id: device.id,
      name: device.name
    };
  }

  if (!createIfMissing) {
    return null;
  }

  return ensureCompanyDevice(env, companyId, "iPhone", "ios", `server-generated-${crypto.randomUUID()}`);
}

async function fetchCompanyDeviceById(env: Env, companyId: number, deviceId: string) {
  return env.DB.prepare(
    `SELECT id, name
     FROM devices
     WHERE company_id = ?
       AND id = ?`
  )
    .bind(companyId, deviceId)
    .first<{
      id: string;
      name: string;
    }>();
}

async function fetchCompanyUnbindCode(env: Env, companyId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT unbind_code
     FROM companies
     WHERE id = ?`
  )
    .bind(companyId)
    .first<{ unbind_code: string | null }>();

  return row?.unbind_code?.trim() || null;
}

async function releaseCompanyDevices(env: Env, companyId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE company_id = ?
         AND revoked_at IS NULL`
    ).bind(companyId),
    env.DB.prepare(
      `DELETE FROM devices
       WHERE company_id = ?`
    ).bind(companyId)
  ]);
}

function jsonAuthPayload(payload: {
  authToken: string;
  user: { id: number; name: string | null; account: string; phone: string | null; role: "owner" | "staff" };
  company: { id: number; name: string; taxId: string; address: string | null; hasAppKeyConfigured: boolean };
  device: { id: string; name: string; token?: string };
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

function parseOptionalJson(payload: string | null): unknown {
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

function parseRegisterAccountBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 80),
    phone: normalizeOptionalBoundedString(body.phone, 40) ?? undefined,
    account: normalizeRequiredBoundedString(body.account, "account", 32),
    password: normalizeRequiredBoundedString(body.password, "password", 128),
    companyName: normalizeRequiredBoundedString(body.companyName, "companyName", 100),
    taxId: normalizeRequiredBoundedString(body.taxId, "taxId", 8),
    address: normalizeOptionalBoundedString(body.address, 255) ?? undefined,
    deviceName: normalizeOptionalBoundedString(body.deviceName, 60) ?? undefined,
    installationId: normalizeRequiredBoundedString(body.installationId, "installationId", 64),
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

function parseLoginAccountBody(body: Record<string, unknown>) {
  return {
    account: normalizeRequiredBoundedString(body.account, "account", 32),
    password: normalizeRequiredBoundedString(body.password, "password", 128),
    deviceName: normalizeOptionalBoundedString(body.deviceName, 60) ?? undefined,
    installationId: normalizeRequiredBoundedString(body.installationId, "installationId", 64),
    unbindCode: normalizeOptionalBoundedString(body.unbindCode, 8) ?? undefined,
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

function parseCatalogCategoryBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    sortOrder: body.sortOrder,
    status: body.status
  };
}

function parseCatalogProductBody(body: Record<string, unknown>) {
  requirePositiveInteger(body.price, "price");
  return {
    categoryId: body.categoryId as number | string | null | undefined,
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    price: body.price,
    imagePath: normalizeOptionalBoundedString(body.imagePath, 255),
    status: body.status,
    taxType: body.taxType,
    sortOrder: body.sortOrder
  };
}

function parseCreatePrintJobBody(body: Record<string, unknown>) {
  requireNonNegativeInteger(body.totalAmount, "totalAmount");
  requireArray(body.items, "items", { min: 1, max: 200 });

  return {
    companyId: body.companyId as number | string,
    deviceId: normalizeOptionalBoundedString(body.deviceId, 64) ?? undefined,
    idempotencyKey: normalizeOptionalBoundedString(body.idempotencyKey, 128) ?? undefined,
    invoiceNumber: normalizeRequiredBoundedString(body.invoiceNumber, "invoiceNumber", 10),
    randomNumber: normalizeRequiredBoundedString(body.randomNumber, "randomNumber", 4),
    issuedAt: normalizeOptionalBoundedString(body.issuedAt, 40) ?? undefined,
    sellerName: normalizeOptionalBoundedString(body.sellerName, 100) ?? undefined,
    sellerIdentifier: normalizeRequiredBoundedString(body.sellerIdentifier, "sellerIdentifier", 8),
    buyerIdentifier: normalizeOptionalBoundedString(body.buyerIdentifier, 8) ?? undefined,
    totalAmount: body.totalAmount,
    items: body.items as Array<{ name: string; quantity: number; unitPrice: number }>,
    qrCodePayload: normalizeOptionalBoundedString(body.qrCodePayload, 4096) ?? undefined,
    barcodePayload: normalizeOptionalBoundedString(body.barcodePayload, 64) ?? undefined
  };
}

function parseManagedDeviceBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 60),
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined,
    installationId: normalizeOptionalBoundedString(body.installationId, 64)
  };
}

function parseManagedDeviceUpdateBody(body: Record<string, unknown>) {
  return {
    name: normalizeOptionalBoundedString(body.name, 60) ?? undefined,
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

function parseAdminProductBody(body: Record<string, unknown>) {
  requirePositiveInteger(body.price, "price");
  return {
    companyId: body.companyId as number | string,
    categoryId: body.categoryId as number | string | null | undefined,
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    price: body.price,
    imagePath: normalizeOptionalBoundedString(body.imagePath, 255),
    status: body.status,
    taxType: body.taxType,
    sortOrder: body.sortOrder
  };
}

function parseResetPasswordBody(body: Record<string, unknown>) {
  return {
    password: normalizeRequiredBoundedString(body.password, "password", 128)
  };
}

function parsePrintJobStatusBody(body: Record<string, unknown>) {
  return {
    message: normalizeOptionalBoundedString(body.message, 255) ?? undefined
  };
}

async function readJson<T>(request: Request): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      throw new HttpError(400, "content_length_invalid");
    }
    if (parsedLength > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request_body_too_large");
    }
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new HttpError(415, "content_type_invalid");
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request_body_too_large");
    }

    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new HttpError(400, "json_object_required");
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_json");
  }
}

function requireArray(value: unknown, field: string, options: { min?: number; max?: number } = {}): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${field}_invalid`);
  }

  if (options.min != null && value.length < options.min) {
    throw new HttpError(400, `${field}_required`);
  }

  if (options.max != null && value.length > options.max) {
    throw new HttpError(400, `${field}_too_many`);
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

function requireNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field}_invalid`);
  }
}

function requireStrictPositiveInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${field}_invalid`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function handleOptions(request: Request, env: Env, url: URL): Response {
  const allowedMethods = allowedMethodsForPath(url.pathname);
  const requestedMethod = request.headers.get("access-control-request-method")?.trim().toUpperCase();
  const requestedHeaders = parseRequestedHeaders(request.headers.get("access-control-request-headers"));

  if (allowedMethods.length === 0 || !requestedMethod || !allowedMethods.includes(requestedMethod)) {
    return json({ error: "cors_route_not_allowed" }, 404);
  }

  if (!isAllowedCorsOrigin(request, env)) {
    return json({ error: "cors_origin_not_allowed" }, 403);
  }

  if (requestedHeaders.some((header) => !allowedCorsRequestHeaders.has(header))) {
    return json({ error: "cors_header_not_allowed" }, 403);
  }

  const response = new Response(null, { status: 204 });
  response.headers.set("access-control-allow-methods", [...allowedMethods, "OPTIONS"].join(", "));
  response.headers.set("access-control-allow-headers", [...allowedCorsRequestHeaders].join(", "));
  response.headers.set("access-control-max-age", "600");
  return response;
}

function finalizeResponse(response: Response, request: Request, env: Env, context: RequestContext): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", context.requestId);
  applySecurityHeaders(headers);
  applyCorsHeaders(headers, request, env);

  if (headers.get("content-type")?.toLowerCase().includes("text/html")) {
    headers.set("content-security-policy", adminContentSecurityPolicy);
  }

  const finalized = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
  logRequest(context, finalized.status);
  return finalized;
}

function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(baseSecurityHeaders)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
}

function applyCorsHeaders(headers: Headers, request: Request, env: Env): void {
  const allowedOrigin = allowedCorsOrigin(request, env);
  if (!allowedOrigin) {
    return;
  }

  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("vary", appendVary(headers.get("vary"), "Origin"));
}

function allowedCorsOrigin(request: Request, env: Env): string | null {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) {
    return null;
  }

  const requestOrigin = normalizeOrigin(new URL(request.url).origin);
  if (origin === requestOrigin) {
    return origin;
  }

  return configuredAllowedOrigins(env).has(origin) ? origin : null;
}

function isAllowedCorsOrigin(request: Request, env: Env): boolean {
  return !request.headers.has("origin") || allowedCorsOrigin(request, env) != null;
}

function configuredAllowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin != null)
  );
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.origin;
  } catch {
    return null;
  }
}

function parseRequestedHeaders(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

function appendVary(currentValue: string | null, nextValue: string): string {
  const existing = (currentValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (existing.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
    return existing.join(", ");
  }

  return [...existing, nextValue].join(", ");
}

function allowedMethodsForPath(pathname: string): string[] {
  if (pathname === "/api/health") return ["GET"];
  if (pathname === "/api/auth/register") return ["POST"];
  if (pathname === "/api/auth/login") return ["POST"];
  if (pathname === "/api/auth/me") return ["GET"];
  if (pathname === "/api/auth/logout") return ["POST"];
  if (pathname === "/api/reports/sales") return ["GET"];
  if (pathname === "/api/devices/register") return ["POST"];
  if (pathname === "/api/devices/me") return ["GET"];
  if (pathname === "/api/devices") return ["GET", "POST"];
  if (pathname === "/api/devices/audit-logs") return ["GET"];
  if (/^\/api\/devices\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (/^\/api\/devices\/[^/]+\/rotate-token$/.test(pathname)) return ["POST"];
  if (pathname === "/api/print-jobs/pending") return ["GET"];
  if (/^\/api\/print-jobs\/[^/]+$/.test(pathname)) return ["GET"];
  if (/^\/api\/print-jobs\/[^/]+\/printed$/.test(pathname)) return ["POST"];
  if (/^\/api\/print-jobs\/[^/]+\/failed$/.test(pathname)) return ["POST"];
  if (pathname === "/api/catalog/categories") return ["GET", "POST"];
  if (/^\/api\/catalog\/categories\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (pathname === "/api/catalog/products") return ["GET", "POST"];
  if (pathname === "/api/catalog/settings") return ["PUT"];
  if (/^\/api\/catalog\/products\/[^/]+$/.test(pathname)) return ["PUT", "DELETE"];
  if (pathname === "/api/admin/summary") return ["GET"];
  if (pathname === "/api/admin/companies") return ["POST"];
  if (pathname === "/api/admin/products") return ["GET", "POST"];
  if (pathname === "/api/admin/users") return ["GET"];
  if (/^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)) return ["POST"];
  if (pathname === "/api/admin/print-jobs") return ["GET", "POST"];
  if (/^\/api\/admin\/print-jobs\/[^/]+\/release$/.test(pathname)) return ["POST"];
  return [];
}

function logRequest(context: RequestContext, status: number): void {
  const event = {
    event: "http.request",
    requestId: context.requestId,
    method: context.method,
    route: context.route,
    status,
    latencyMs: Date.now() - context.startedAt,
    companyId: context.companyId ?? null,
    userId: context.userId ?? null,
    deviceId: context.deviceId ?? null,
    actorType: context.actorType ?? "anonymous"
  };

  const serialized = JSON.stringify(event);
  if (status >= 500) {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

function routeName(pathname: string): string {
  if (pathname === "/") return "GET /";
  const methods = allowedMethodsForPath(pathname);
  if (methods.length > 0) {
    return `${methods.join("|")} ${pathname.replace(/\/[0-9a-fA-F-]{16,}/g, "/:id")}`;
  }
  if (/^\/api\/devices\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/devices/:id";
  if (/^\/api\/devices\/[^/]+\/rotate-token$/.test(pathname)) return "POST /api/devices/:id/rotate-token";
  if (/^\/api\/print-jobs\/[^/]+$/.test(pathname)) return "GET /api/print-jobs/:id";
  if (/^\/api\/print-jobs\/[^/]+\/printed$/.test(pathname)) return "POST /api/print-jobs/:id/printed";
  if (/^\/api\/print-jobs\/[^/]+\/failed$/.test(pathname)) return "POST /api/print-jobs/:id/failed";
  if (/^\/api\/catalog\/categories\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/catalog/categories/:id";
  if (/^\/api\/catalog\/products\/[^/]+$/.test(pathname)) return "PUT|DELETE /api/catalog/products/:id";
  if (/^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)) return "POST /api/admin/users/:id/reset-password";
  if (/^\/api\/admin\/print-jobs\/[^/]+\/release$/.test(pathname)) return "POST /api/admin/print-jobs/:id/release";
  return "unknown";
}

class HttpError extends Error {
  readonly code: string;
  readonly fieldErrors: Array<{ field: string; code: string; message?: string }>;

  constructor(
    readonly status: number,
    message: string,
    options?: {
      code?: string;
      fieldErrors?: Array<{ field: string; code: string; message?: string }>;
    }
  ) {
    super(message);
    this.code = options?.code ?? message;
    this.fieldErrors = options?.fieldErrors ?? [];
  }
}

function buildErrorResponse(error: unknown, requestId: string) {
  if (error instanceof HttpError) {
    return {
      error: error.message,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
      requestId
    };
  }

  const message = error instanceof Error ? error.message : "unknown_error";
  return {
    error: message,
    code: message,
    message,
    fieldErrors: [],
    requestId
  };
}

function buildInternalErrorResponse(requestId: string) {
  return {
    error: "internal_error",
    code: "internal_error",
    message: "internal_error",
    fieldErrors: [],
    requestId
  };
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
