import assert from "node:assert/strict";
import test from "node:test";
import worker, { type Env } from "../src/index";
import { createMigratedSqlD1 } from "./helpers/sql-d1";

type TestEnv = Env & { DB: D1Database };

test("Worker integration: tenant isolation and auth", async () => {
  const env = await makeEnv();
  const tenantA = await registerTenant(env, "tenanta", "12345678");
  const tenantB = await registerTenant(env, "tenantb", "87654321");

  const unauthorized = await api(env, "/api/catalog/products");
  assert.equal(unauthorized.status, 401);

  const categoryResponse = await apiJson<{ category: { id: number } }>(
    env,
    "/api/catalog/categories",
    {
      method: "POST",
      authToken: tenantA.authToken,
      body: { name: "飲品", sortOrder: 0, status: "顯示" }
    },
    201
  );

  await apiJson(
    env,
    "/api/catalog/products",
    {
      method: "POST",
      authToken: tenantA.authToken,
      body: {
        categoryId: categoryResponse.category.id,
        name: "奶茶",
        price: 45,
        imagePath: null,
        status: "顯示",
        taxType: "含稅",
        sortOrder: 1
      }
    },
    201
  );

  const tenantBProducts = await apiJson<{ products: Array<{ name: string }> }>(
    env,
    "/api/catalog/products",
    { authToken: tenantB.authToken },
    200
  );
  assert.deepEqual(tenantBProducts.products, []);

  const badAdmin = await api(env, "/api/admin/companies", {
    method: "POST",
    token: "wrong",
    body: { name: "Bad", taxId: "11111111" }
  });
  assert.equal(badAdmin.status, 401);
});

test("Worker integration: claim race, status transition, idempotency, invalid payload", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantc", "11223344");
  const secondDevice = await apiJson<{ token: string; device: { id: string } }>(
    env,
    "/api/devices",
    {
      method: "POST",
      authToken: tenant.authToken,
      body: { name: "Second iPhone", platform: "ios", installationId: "second-device" }
    },
    201
  );

  const createBody = printJobBody(tenant.company.id, "AB12345678", "job-key-1");
  const firstCreate = await apiJson<{ id: string; invoiceId: string }>(
    env,
    "/api/admin/print-jobs",
    { method: "POST", token: "admin-token", body: createBody },
    200
  );
  const duplicateCreate = await apiJson<{ id: string; invoiceId: string }>(
    env,
    "/api/admin/print-jobs",
    { method: "POST", token: "admin-token", body: createBody },
    200
  );
  assert.equal(duplicateCreate.id, firstCreate.id);
  assert.equal(duplicateCreate.invoiceId, firstCreate.invoiceId);

  const firstClaim = await apiJson<{ jobs: Array<{ id: string; status: string; claimedBy: string }> }>(
    env,
    "/api/print-jobs/pending",
    { token: tenant.device.token },
    200
  );
  assert.equal(firstClaim.jobs.length, 1);
  assert.equal(firstClaim.jobs[0].id, firstCreate.id);
  assert.equal(firstClaim.jobs[0].status, "printing");

  const secondClaim = await apiJson<{ jobs: unknown[] }>(
    env,
    "/api/print-jobs/pending",
    { token: secondDevice.token },
    200
  );
  assert.equal(secondClaim.jobs.length, 0);

  await apiJson(
    env,
    `/api/print-jobs/${firstCreate.id}/printed`,
    { method: "POST", token: tenant.device.token, body: {} },
    200
  );
  const idempotentPrinted = await apiJson<{ ok: true; idempotent?: true }>(
    env,
    `/api/print-jobs/${firstCreate.id}/printed`,
    { method: "POST", token: tenant.device.token, body: {} },
    200
  );
  assert.equal(idempotentPrinted.idempotent, true);

  const failedAfterPrinted = await api(env, `/api/print-jobs/${firstCreate.id}/failed`, {
    method: "POST",
    token: tenant.device.token,
    body: { message: "late failure" }
  });
  assert.equal(failedAfterPrinted.status, 409);

  const invalidPayload = await api(env, "/api/admin/print-jobs", {
    method: "POST",
    token: "admin-token",
    body: printJobBody(tenant.company.id, "BAD", "invalid-key")
  });
  assert.equal(invalidPayload.status, 400);

  const secondCreate = await apiJson<{ id: string }>(
    env,
    "/api/admin/print-jobs",
    { method: "POST", token: "admin-token", body: printJobBody(tenant.company.id, "AB12345679", "job-key-2") },
    200
  );
  await apiJson<{ jobs: Array<{ id: string }> }>(
    env,
    "/api/print-jobs/pending",
    { token: tenant.device.token },
    200
  );
  await apiJson(
    env,
    `/api/print-jobs/${secondCreate.id}/failed`,
    { method: "POST", token: tenant.device.token, body: { message: "paper out" } },
    200
  );

  const auditRows = await env.DB.prepare(
    `SELECT action, details_json
     FROM audit_logs
     WHERE company_id = ?
     ORDER BY created_at ASC`
  )
    .bind(tenant.company.id)
    .all<{ action: string; details_json: string | null }>();
  const actions = auditRows.results.map((row) => row.action);
  assert.ok(actions.includes("admin.print_job.create"));
  assert.ok(actions.includes("admin.print_job.idempotent_replay"));
  assert.ok(actions.includes("print_job.claim"));
  assert.ok(actions.includes("print_job.printed"));
  assert.ok(actions.includes("print_job.failed"));
  assert.equal(auditRows.results.some((row) => row.details_json?.includes("AB12345678")), false);
});

test("Worker integration: CORS is allowlisted and security headers are present", async () => {
  const env = await makeEnv({ CORS_ALLOWED_ORIGINS: "https://staging.example.com, https://app.example.com" });

  const health = await api(env, "/api/health");
  assert.equal(health.headers.get("access-control-allow-origin"), null);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("referrer-policy"), "no-referrer");
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("cache-control"), "no-store");

  const sameOriginPreflight = await api(env, "/api/catalog/products", {
    method: "OPTIONS",
    headers: {
      Origin: "https://unit.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type"
    }
  });
  assert.equal(sameOriginPreflight.status, 204);
  assert.equal(sameOriginPreflight.headers.get("access-control-allow-origin"), "https://unit.test");
  assert.match(sameOriginPreflight.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.doesNotMatch(sameOriginPreflight.headers.get("access-control-allow-origin") ?? "", /\*/);

  const allowlistedPreflight = await api(env, "/api/admin/print-jobs", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, idempotency-key"
    }
  });
  assert.equal(allowlistedPreflight.status, 204);
  assert.equal(allowlistedPreflight.headers.get("access-control-allow-origin"), "https://app.example.com");

  const disallowedOrigin = await api(env, "/api/admin/print-jobs", {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization"
    }
  });
  assert.equal(disallowedOrigin.status, 403);
  assert.equal(disallowedOrigin.headers.get("access-control-allow-origin"), null);

  const disallowedRoute = await api(env, "/api/not-real", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization"
    }
  });
  assert.equal(disallowedRoute.status, 404);

  const adminPage = await api(env, "/");
  assert.equal(adminPage.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
  assert.equal(adminPage.headers.get("x-frame-options"), "DENY");
  assert.equal(adminPage.headers.get("x-content-type-options"), "nosniff");
});

test("Worker integration: request logs and auth audit are structured without secrets", async () => {
  const env = await makeEnv();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const response = await api(env, "/api/health", {
      headers: { Authorization: "Bearer super-secret-token" }
    });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("x-request-id"));
  } finally {
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  const log = JSON.parse(logs[0]) as {
    event: string;
    requestId: string;
    route: string;
    status: number;
    latencyMs: number;
    companyId: number | null;
    deviceId: string | null;
  };
  assert.equal(log.event, "http.request");
  assert.equal(log.route, "GET /api/health");
  assert.equal(log.status, 200);
  assert.equal(log.companyId, null);
  assert.equal(log.deviceId, null);
  assert.equal(logs[0].includes("super-secret-token"), false);

  const tenant = await registerTenant(env, "tenantd", "44332211");
  const failed = await api(env, "/api/auth/login", {
    method: "POST",
    body: {
      account: "tenantd",
      password: "wrong-password",
      deviceName: "Primary iPhone",
      installationId: "tenantd-device",
      platform: "ios"
    }
  });
  assert.equal(failed.status, 401);

  const audit = await env.DB.prepare(
    `SELECT action, details_json
     FROM audit_logs
     WHERE company_id = ?
       AND action = 'auth.login_failed'
     LIMIT 1`
  )
    .bind(tenant.company.id)
    .first<{ action: string; details_json: string }>();
  assert.equal(audit?.action, "auth.login_failed");
  assert.equal(audit?.details_json.includes("wrong-password"), false);
  assert.equal(audit?.details_json.includes("invalid_credentials"), true);
});

test("Worker scheduled observability logs stale print queues", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenante", "55667788");
  const created = await apiJson<{ id: string }>(
    env,
    "/api/admin/print-jobs",
    { method: "POST", token: "admin-token", body: printJobBody(tenant.company.id, "AB12345680", "job-key-3") },
    200
  );
  await env.DB.prepare(
    `UPDATE print_jobs
     SET created_at = datetime('now', '-20 minutes')
     WHERE id = ?`
  )
    .bind(created.id)
    .run();

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    await (worker as unknown as { scheduled(controller: unknown, env: TestEnv): Promise<void> }).scheduled({}, env);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.some((line) => line.includes("print_job.pending_stale")), true);
  assert.equal(warnings.some((line) => line.includes(String(tenant.company.id))), true);
});

async function makeEnv(overrides: Partial<TestEnv> = {}): Promise<TestEnv> {
  const db = await createMigratedSqlD1();
  return {
    DB: db as unknown as D1Database,
    ADMIN_TOKEN: "admin-token",
    ...overrides
  };
}

async function registerTenant(env: TestEnv, account: string, taxId: string) {
  return apiJson<{
    authToken: string;
    user: { id: number };
    company: { id: number };
    device: { id: string; token: string };
  }>(
    env,
    "/api/auth/register",
    {
      method: "POST",
      body: {
        name: `${account} owner`,
        phone: "0912345678",
        account,
        password: "secret123",
        companyName: `${account} company`,
        taxId,
        address: "Taipei",
        deviceName: "Primary iPhone",
        installationId: `${account}-device`,
        platform: "ios"
      }
    },
    200
  );
}

async function apiJson<T>(
  env: TestEnv,
  path: string,
  options: ApiOptions = {},
  expectedStatus = 200
): Promise<T> {
  const response = await api(env, path, options);
  if (response.status !== expectedStatus) {
    assert.equal(response.status, expectedStatus, await response.text());
  }
  return response.json() as Promise<T>;
}

async function api(env: TestEnv, path: string, options: ApiOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const token = options.authToken ?? options.token;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return worker.fetch(
    new Request(`https://unit.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }),
    env
  );
}

type ApiOptions = {
  method?: string;
  token?: string;
  authToken?: string;
  headers?: HeadersInit;
  body?: unknown;
};

function printJobBody(companyId: number, invoiceNumber: string, idempotencyKey: string) {
  return {
    companyId,
    idempotencyKey,
    invoiceNumber,
    randomNumber: "1234",
    issuedAt: "2026-07-09T13:59:00Z",
    sellerName: "測試商店",
    sellerIdentifier: "12345678",
    buyerIdentifier: null,
    totalAmount: 45,
    items: [{ name: "奶茶", quantity: 1, unitPrice: 45 }],
    qrCodePayload: "QR",
    barcodePayload: invoiceNumber
  };
}
