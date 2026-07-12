import { adminPage } from "./admin-page";
import {
  authSessionExpiryTimestamp,
  bearerToken,
  clientIdentifier,
  generateSessionToken,
  issueAuthSessionStorageValue,
  issueDeviceTokenStorageValue,
  normalizeAccount,
  normalizeUserRole,
  requireOwnerAccess,
  requirePassword
} from "./auth";
import {
  createCatalogCategory,
  createCatalogProduct,
  createProduct,
  deleteCatalogCategory,
  deleteCatalogProduct,
  listCatalogCategories,
  listCatalogProducts,
  listProducts,
  updateCatalogCategory,
  updateCatalogProduct,
  updateCatalogSettings
} from "./catalog";
import {
  hashAdminToken,
  hashAuthSessionToken,
  hashDeviceToken,
  hashPassword,
  verifyPassword
} from "./crypto-utils";
import {
  createManagedDevice,
  ensureCompanyDevice,
  fetchCompanyDeviceById,
  fetchPrimaryCompanyDevice,
  getDeviceMe,
  listManagedDevices,
  registerDevice,
  revokeManagedDevice,
  rotateManagedDeviceToken,
  updateManagedDevice
} from "./devices";
import type {
  AdminUserRow,
  AuditLogRow,
  DeviceIdentity,
  DeviceSession,
  UserSession
} from "./domain-types";
import { buildErrorResponse, buildInternalErrorResponse, html, HttpError, json } from "./http";
import { createAmegoInvoice } from "./invoice-issuance";
import {
  getInvoice,
  listInvoices,
  refreshInvoice,
  reprintInvoice,
  voidInvoice
} from "./invoice-management";
import {
  adminListPrintJobs,
  adminReleasePrintJob,
  checkPrintJobQueueHealth,
  createPrintJob,
  getPrintJob,
  listPendingPrintJobs,
  updatePrintJobStatus
} from "./print-jobs";
import { listSalesReport } from "./reports";
import { finalizeResponse, handleOptions } from "./responses";
import {
  generateUnbindCode,
  hasConfiguredAppKey,
  normalizeAuditLogLimit,
  normalizeInstallationId,
  normalizeOptionalBoundedString,
  normalizeOptionalString,
  normalizeRequiredBoundedString,
  parseLoginAccountBody,
  parseOptionalJson,
  parsePositiveId,
  parseRegisterAccountBody,
  parseResetPasswordBody
} from "./request-parsers";
import { routeName } from "./routes";
import type { Env, RequestContext } from "./types";
import { readJson, requireString } from "./validation";
export type { Env } from "./types";

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

      if (url.pathname === "/api/invoices" && request.method === "POST") {
        await enforceRateLimit(request, env, "invoice_issue", 30, 10 * 60);
        const session = await requireUserSession(request, env, context);
        return reply(await createAmegoInvoice(request, env, session, context, writeAuditLog));
      }

      if (url.pathname === "/api/invoices" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listInvoices(env, session, url));
      }

      const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
      if (invoiceMatch && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await getInvoice(env, session, invoiceMatch[1]));
      }

      const invoiceRefreshMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/refresh$/);
      if (invoiceRefreshMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "invoice_refresh", 30, 10 * 60);
        const session = await requireUserSession(request, env, context);
        return reply(await refreshInvoice(env, session, invoiceRefreshMatch[1], writeAuditLog));
      }

      const invoiceReprintMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/reprint$/);
      if (invoiceReprintMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "invoice_reprint", 30, 10 * 60);
        const session = await requireUserSession(request, env, context);
        return reply(await reprintInvoice(env, session, invoiceReprintMatch[1], writeAuditLog));
      }

      const invoiceVoidMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/void$/);
      if (invoiceVoidMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "invoice_void", 10, 10 * 60);
        const session = await requireUserSession(request, env, context);
        return reply(await voidInvoice(env, session, invoiceVoidMatch[1], writeAuditLog));
      }

      if (url.pathname === "/api/devices/register" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_devices_register", 30, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await registerDevice(request, env, context, writeSystemAuditLog));
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
        return reply(await createManagedDevice(request, env, session, writeAuditLog));
      }

      if (url.pathname === "/api/devices/audit-logs" && request.method === "GET") {
        const session = await requireUserSession(request, env, context);
        return reply(await listAuditLogs(env, session, url));
      }

      const managedDeviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
      if (managedDeviceMatch && request.method === "PUT") {
        const session = await requireUserSession(request, env, context);
        return reply(await updateManagedDevice(request, env, session, managedDeviceMatch[1], writeAuditLog));
      }

      if (managedDeviceMatch && request.method === "DELETE") {
        const session = await requireUserSession(request, env, context);
        return reply(await revokeManagedDevice(env, session, managedDeviceMatch[1], writeAuditLog));
      }

      const managedDeviceRotateMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/rotate-token$/);
      if (managedDeviceRotateMatch && request.method === "POST") {
        const session = await requireUserSession(request, env, context);
        return reply(await rotateManagedDeviceToken(env, session, managedDeviceRotateMatch[1], writeAuditLog));
      }

      if (url.pathname === "/api/print-jobs/pending" && request.method === "GET") {
        const device = await requireDevice(request, env, context);
        return reply(await listPendingPrintJobs(env, device, context, writeSystemAuditLog));
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
        return reply(await updatePrintJobStatus(env, device, printJobPrinted[1], "printed", context, writeSystemAuditLog));
      }

      const printJobFailed = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/failed$/);
      if (printJobFailed && request.method === "POST") {
        const device = await requireDevice(request, env, context);
        return reply(await updatePrintJobStatus(env, device, printJobFailed[1], "failed", context, writeSystemAuditLog, request));
      }

      if (url.pathname === "/api/admin/summary" && request.method === "GET") {
        await requireAdmin(request, env, context);
        return reply(await adminSummary(env));
      }

      if (url.pathname === "/api/admin/companies" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_companies_create", 20, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await createCompany(request, env, context));
      }

      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        await requireAdmin(request, env, context);
        return reply(await listProducts(env, url));
      }

      if (url.pathname === "/api/admin/products" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_products_create", 60, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await createProduct(request, env, context, writeSystemAuditLog));
      }

      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        await requireAdmin(request, env, context);
        return reply(await adminListUsers(env, url));
      }

      const adminUserResetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
      if (adminUserResetMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_users_reset_password", 10, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await adminResetUserPassword(request, env, adminUserResetMatch[1], context));
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "GET") {
        await requireAdmin(request, env, context);
        return reply(await adminListPrintJobs(env));
      }

      if (url.pathname === "/api/admin/print-jobs" && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_print_jobs_create", 60, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await createPrintJob(request, env, context, writeSystemAuditLog));
      }

      const adminPrintJobReleaseMatch = url.pathname.match(/^\/api\/admin\/print-jobs\/([^/]+)\/release$/);
      if (adminPrintJobReleaseMatch && request.method === "POST") {
        await enforceRateLimit(request, env, "admin_print_jobs_release", 60, 10 * 60);
        await requireAdmin(request, env, context);
        return reply(await adminReleasePrintJob(env, adminPrintJobReleaseMatch[1], context, writeSystemAuditLog));
      }

      throw new HttpError(404, "not_found");
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

  const passwordHash = await hashPassword(input.password);
  const deviceId = crypto.randomUUID();
  const deviceToken = generateSessionToken();
  const deviceTokenHash = await hashDeviceToken(deviceToken);
  const sessionToken = generateSessionToken();
  const sessionTokenHash = await hashAuthSessionToken(sessionToken);
  const expiresAt = authSessionExpiryTimestamp();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO companies (id, name, tax_id, address, amego_app_key_secret_name, amego_app_key, unbind_code)
       VALUES (NULL, ?, ?, ?, NULL, NULL, ?)`
    ).bind(input.companyName.trim(), taxId, address, generateUnbindCode()),
    env.DB.prepare(
      `INSERT INTO users (id, company_id, email, password_hash, name, phone, role)
       VALUES (
         NULL,
         (SELECT id FROM companies WHERE tax_id = ?),
         ?, ?, ?, ?, 'owner'
       )`
    ).bind(taxId, account, passwordHash, input.name.trim(), phone),
    env.DB.prepare(
      `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
       VALUES (
         ?,
         (SELECT id FROM companies WHERE tax_id = ?),
         ?, ?, ?, ?, ?
       )`
    ).bind(deviceId, taxId, deviceName, issueDeviceTokenStorageValue(deviceId), deviceTokenHash, platform, installationId),
    env.DB.prepare(
      `INSERT INTO auth_sessions (token, token_hash, user_id, company_id, device_id, expires_at, revoked_at)
       VALUES (
         ?,
         ?,
         (SELECT id FROM users WHERE lower(email) = ?),
         (SELECT id FROM companies WHERE tax_id = ?),
         ?,
         ?,
         NULL
       )`
    ).bind(issueAuthSessionStorageValue(sessionTokenHash), sessionTokenHash, account, taxId, deviceId, expiresAt)
  ]);

  const row = await env.DB.prepare(
    `SELECT u.id AS user_id, c.id AS company_id
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE lower(u.email) = ?`
  )
    .bind(account)
    .first<{ user_id: number; company_id: number }>();
  if (!row) {
    throw new HttpError(500, "registration_unavailable");
  }

  return jsonAuthPayload({
    authToken: sessionToken,
    user: {
      id: row.user_id,
      name: input.name.trim(),
      account,
      phone,
      role: "owner"
    },
    company: {
      id: row.company_id,
      name: input.companyName.trim(),
      taxId,
      address,
      hasAppKeyConfigured: false
    },
    device: {
      id: deviceId,
      name: deviceName,
      token: deviceToken
    }
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
     WHERE token_hash = ?
       AND revoked_at IS NULL`
  )
    .bind(session.token_hash)
    .run();

  return json({ ok: true });
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

  const tokenHash = await hashAuthSessionToken(token);
  const row = await env.DB.prepare(
    `SELECT
       s.token,
       s.token_hash,
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
     WHERE (s.token_hash = ? OR s.token = ?)
       AND s.revoked_at IS NULL
       AND s.expires_at IS NOT NULL
       AND s.expires_at > CURRENT_TIMESTAMP`
  )
    .bind(tokenHash, token)
    .first<UserSession>();

  if (!row) {
    throw new HttpError(401, "invalid_auth_token");
  }

  await upgradeLegacyAuthSessionTokenIfNeeded(env, row.token, token, tokenHash);
  const session: UserSession = {
    ...row,
    token,
    token_hash: tokenHash
  };

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

async function requireAdmin(request: Request, env: Env, context?: RequestContext): Promise<void> {
  const configuredTokenHash = env.ADMIN_TOKEN_HASH?.trim();
  const configuredToken = env.ADMIN_TOKEN?.trim();
  if (!configuredTokenHash && !configuredToken) {
    throw new HttpError(500, "admin_token_not_configured");
  }

  const token = bearerToken(request);
  const matched = token
    ? configuredTokenHash
      ? await hashAdminToken(token) === configuredTokenHash
      : token === configuredToken
    : false;

  if (!matched) {
    console.warn(JSON.stringify({
      event: "admin.auth_failed",
      requestId: context?.requestId ?? null,
      route: context?.route ?? "unknown"
    }));
    throw new HttpError(401, "invalid_admin_token");
  }

  if (context) {
    context.actorType = "admin";
  }
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

async function createAuthSession(env: Env, userId: number, companyId: number, deviceId: string | null): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = await hashAuthSessionToken(token);
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token, token_hash, user_id, company_id, device_id, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  )
    .bind(issueAuthSessionStorageValue(tokenHash), tokenHash, userId, companyId, deviceId, authSessionExpiryTimestamp())
    .run();
  return token;
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

async function upgradeLegacyAuthSessionTokenIfNeeded(
  env: Env,
  storedToken: string,
  rawToken: string,
  tokenHash: string
): Promise<void> {
  if (storedToken !== rawToken) {
    return;
  }

  await env.DB.prepare(
    `UPDATE auth_sessions
     SET token_hash = ?, token = ?
     WHERE token = ?
       AND (token_hash IS NULL OR trim(token_hash) = '')`
  )
    .bind(tokenHash, issueAuthSessionStorageValue(tokenHash), rawToken)
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

function jsonAuthPayload(payload: {
  authToken: string;
  user: { id: number; name: string | null; account: string; phone: string | null; role: "owner" | "staff" | "printer" };
  company: { id: number; name: string; taxId: string; address: string | null; hasAppKeyConfigured: boolean };
  device: { id: string; name: string; token?: string };
}): Response {
  return json(payload);
}

async function count(env: Env, table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS value FROM ${table}`).first<{ value: number }>();
  return row?.value ?? 0;
}
