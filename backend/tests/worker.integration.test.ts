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

test("Worker integration: validation errors include request id, localized message, and field errors", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenanth", "88990011");

  const response = await api(env, "/api/catalog/products", {
    method: "POST",
    authToken: tenant.authToken,
    headers: { "cf-ray": "test-request-id" },
    body: {
      categoryId: null,
      name: "超大金額",
      price: 100_000_000,
      status: "顯示",
      taxType: "含稅",
      sortOrder: 0
    }
  });
  assert.equal(response.status, 400);

  const payload = await response.json() as {
    code: string;
    message: string;
    requestId: string;
    fieldErrors: Array<{ field: string; code: string; message: string }>;
  };
  assert.equal(payload.code, "price_invalid");
  assert.equal(payload.message, "這個欄位格式不正確。");
  assert.equal(payload.requestId, "test-request-id");
  assert.deepEqual(payload.fieldErrors, [{
    field: "price",
    code: "invalid",
    message: "這個欄位格式不正確。"
  }]);
});

test("Worker integration: claim race, status transition, idempotency, invalid payload", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantc", "11223344");
  await env.DB.prepare(
    `UPDATE companies SET max_bound_devices = 2 WHERE id = ?`
  ).bind(tenant.company.id).run();
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

  const createBody = {
    ...printJobBody(tenant.company.id, "AB12345678", "job-key-1"),
    leftQRCodePayload: "AMEGO-LEFT-PAYLOAD",
    rightQRCodePayload: "AMEGO-RIGHT-PAYLOAD"
  };
  const firstCreate = await apiJson<{
    id: string;
    invoiceId: string;
    payload: { leftQRCodePayload: string; rightQRCodePayload: string };
  }>(
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
  assert.equal(firstCreate.payload.leftQRCodePayload, "AMEGO-LEFT-PAYLOAD");
  assert.equal(firstCreate.payload.rightQRCodePayload, "AMEGO-RIGHT-PAYLOAD");

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

  const invalidAmount = await api(env, "/api/admin/print-jobs", {
    method: "POST",
    token: "admin-token",
    body: {
      ...printJobBody(tenant.company.id, "AB12345677", "invalid-amount-key"),
      totalAmount: 100_000_000
    }
  });
  assert.equal(invalidAmount.status, 400);

  const unpairedQrPayload = await api(env, "/api/admin/print-jobs", {
    method: "POST",
    token: "admin-token",
    body: {
      ...printJobBody(tenant.company.id, "AB12345676", "unpaired-qr-key"),
      leftQRCodePayload: "AMEGO-LEFT-ONLY"
    }
  });
  assert.equal(unpairedQrPayload.status, 400);
  assert.equal((await unpairedQrPayload.json() as { code: string }).code, "qr_payload_pair_required");

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

test("Worker integration: auth sessions are hashed and legacy sessions upgrade", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantf", "66778899");

  const stored = await env.DB.prepare(
    `SELECT token, token_hash
     FROM auth_sessions
     WHERE user_id = ?`
  )
    .bind(tenant.user.id)
    .first<{ token: string; token_hash: string | null }>();
  assert.ok(stored?.token_hash);
  assert.notEqual(stored?.token, tenant.authToken);
  assert.match(stored?.token ?? "", /^stored:/);

  await env.DB.prepare(
    `UPDATE auth_sessions
     SET token = ?, token_hash = NULL
     WHERE user_id = ?`
  )
    .bind(tenant.authToken, tenant.user.id)
    .run();

  const me = await api(env, "/api/auth/me", { authToken: tenant.authToken });
  assert.equal(me.status, 200);

  const upgraded = await env.DB.prepare(
    `SELECT token, token_hash
     FROM auth_sessions
     WHERE user_id = ?`
  )
    .bind(tenant.user.id)
    .first<{ token: string; token_hash: string | null }>();
  assert.ok(upgraded?.token_hash);
  assert.notEqual(upgraded?.token, tenant.authToken);
  assert.match(upgraded?.token ?? "", /^stored:/);
});

test("Worker integration: admin hash secret and role authorization", async () => {
  const env = await makeEnv({
    ADMIN_TOKEN: undefined,
    ADMIN_TOKEN_HASH: await hashAdminTokenForTest("admin-token")
  });
  const tenant = await registerTenant(env, "tenantg", "77889900");

  const adminOk = await api(env, "/api/admin/summary", { token: "admin-token" });
  assert.equal(adminOk.status, 200);
  const adminBad = await api(env, "/api/admin/summary", { token: "wrong-token" });
  assert.equal(adminBad.status, 401);

  await env.DB.prepare(
    `UPDATE users
     SET role = 'staff'
     WHERE id = ?`
  )
    .bind(tenant.user.id)
    .run();

  const staffCategory = await api(env, "/api/catalog/categories", {
    method: "POST",
    authToken: tenant.authToken,
    body: { name: "Staff OK", sortOrder: 0, status: "顯示" }
  });
  assert.equal(staffCategory.status, 403);

  const staffCategoryList = await api(env, "/api/catalog/categories", {
    authToken: tenant.authToken
  });
  assert.equal(staffCategoryList.status, 200);

  const staffDeviceCreate = await api(env, "/api/devices", {
    method: "POST",
    authToken: tenant.authToken,
    body: { name: "Staff Device", platform: "ios", installationId: "staff-device" }
  });
  assert.equal(staffDeviceCreate.status, 403);

  await env.DB.prepare(
    `UPDATE users
     SET role = 'printer'
     WHERE id = ?`
  )
    .bind(tenant.user.id)
    .run();

  const printerCategory = await api(env, "/api/catalog/categories", {
    method: "POST",
    authToken: tenant.authToken,
    body: { name: "Printer Blocked", sortOrder: 0, status: "顯示" }
  });
  assert.equal(printerCategory.status, 403);

  const devicePending = await api(env, "/api/print-jobs/pending", { token: tenant.device.token });
  assert.equal(devicePending.status, 200);
});

test("Worker integration: owner manages staff and staff cannot mutate catalog", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantstaff", "44556677");
  const otherTenant = await registerTenant(env, "staffother", "55443322");
  await env.DB.prepare(
    `UPDATE companies SET max_bound_devices = 2 WHERE id = ?`
  ).bind(tenant.company.id).run();

  const created = await apiJson<{
    member: { id: number; account: string; role: string; isActive: boolean };
  }>(env, "/api/members", {
    method: "POST",
    authToken: tenant.authToken,
    body: {
      account: "counterstaff",
      password: "temp1234",
      name: "櫃台員工",
      phone: "0911000000"
    }
  }, 201);
  assert.equal(created.member.role, "staff");
  assert.equal(created.member.isActive, true);

  const updated = await apiJson<{
    member: { name: string; phone: string | null; isActive: boolean };
  }>(env, `/api/members/${created.member.id}`, {
    method: "PUT",
    authToken: tenant.authToken,
    body: { name: "早班員工", phone: "0922000000", isActive: true }
  });
  assert.equal(updated.member.name, "早班員工");
  assert.equal(updated.member.phone, "0922000000");

  await apiJson(env, `/api/members/${created.member.id}/reset-password`, {
    method: "POST",
    authToken: tenant.authToken,
    body: { password: "newpass123" }
  });

  const members = await apiJson<{ members: Array<{ id: number }> }>(
    env,
    "/api/members",
    { authToken: tenant.authToken }
  );
  assert.deepEqual(members.members.map((member) => member.id), [created.member.id]);

  const crossTenantUpdate = await api(env, `/api/members/${created.member.id}`, {
    method: "PUT",
    authToken: otherTenant.authToken,
    body: { name: "不應成功" }
  });
  assert.equal(crossTenantUpdate.status, 404);
  const finalOwnerUpdate = await api(env, `/api/members/${tenant.user.id}`, {
    method: "PUT",
    authToken: tenant.authToken,
    body: { isActive: false }
  });
  assert.equal(finalOwnerUpdate.status, 404);

  const staffLogin = await apiJson<{ authToken: string }>(env, "/api/auth/login", {
    method: "POST",
    body: {
      account: "counterstaff",
      password: "newpass123",
      deviceName: "Staff iPhone",
      installationId: "tenantstaff-staff-phone",
      platform: "ios"
    }
  });

  const staffRead = await api(env, "/api/catalog/products", { authToken: staffLogin.authToken });
  assert.equal(staffRead.status, 200);
  const staffInvoices = await api(env, "/api/invoices?date=2026-07-14", { authToken: staffLogin.authToken });
  assert.equal(staffInvoices.status, 200);
  const staffIssueValidation = await api(env, "/api/invoices", {
    method: "POST",
    authToken: staffLogin.authToken,
    body: {}
  });
  assert.equal(staffIssueValidation.status, 400);
  const staffReprintMissing = await api(env, "/api/invoices/missing/reprint", {
    method: "POST",
    authToken: staffLogin.authToken
  });
  assert.equal(staffReprintMissing.status, 404);
  const staffWrite = await api(env, "/api/catalog/categories", {
    method: "POST",
    authToken: staffLogin.authToken,
    body: { name: "不可新增", sortOrder: 0, status: "顯示" }
  });
  assert.equal(staffWrite.status, 403);
  const staffMemberList = await api(env, "/api/members", { authToken: staffLogin.authToken });
  assert.equal(staffMemberList.status, 403);
  const staffReport = await api(
    env,
    "/api/reports/sales?startDate=2026-07-01&endDate=2026-07-14",
    { authToken: staffLogin.authToken }
  );
  assert.equal(staffReport.status, 403);
  const staffVoid = await api(env, "/api/invoices/not-owned-by-staff/void", {
    method: "POST",
    authToken: staffLogin.authToken
  });
  assert.equal(staffVoid.status, 403);

  await apiJson(env, `/api/members/${created.member.id}`, {
    method: "DELETE",
    authToken: tenant.authToken
  });
  const deletionAudit = await env.DB.prepare(
    `SELECT action, details_json FROM audit_logs
     WHERE company_id = ? AND target_type = 'user' AND target_id = ? AND action = 'staff.delete'`
  ).bind(tenant.company.id, String(created.member.id)).first<{ action: string; details_json: string }>();
  assert.equal(deletionAudit?.action, "staff.delete");
  assert.equal(deletionAudit?.details_json.includes("newpass123"), false);
  const activeMembersAfterDelete = await apiJson<{ members: Array<{ id: number }> }>(
    env,
    "/api/members",
    { authToken: tenant.authToken }
  );
  assert.equal(activeMembersAfterDelete.members.some((member) => member.id === created.member.id), false);
  const allMembersAfterDelete = await apiJson<{ members: Array<{ id: number; isActive: boolean }> }>(
    env,
    "/api/members?includeInactive=true",
    { authToken: tenant.authToken }
  );
  assert.equal(allMembersAfterDelete.members.find((member) => member.id === created.member.id)?.isActive, false);
  const disabledSession = await api(env, "/api/catalog/products", { authToken: staffLogin.authToken });
  assert.equal(disabledSession.status, 401);
  const disabledLogin = await api(env, "/api/auth/login", {
    method: "POST",
    body: {
      account: "counterstaff",
      password: "newpass123",
      deviceName: "Staff iPhone",
      installationId: "tenantstaff-staff-phone",
      platform: "ios"
    }
  });
  assert.equal(disabledLogin.status, 403);
});

test("Worker integration: company device quota counts installations and releases one device", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantquota", "66778899");

  const samePhone = await apiJson<{
    authToken: string;
    company: { deviceLimit: number; deviceUsed: number };
  }>(
    env,
    "/api/auth/login",
    {
      method: "POST",
      body: {
        account: "tenantquota",
        password: "secret123",
        deviceName: "Primary iPhone",
        installationId: "tenantquota-device",
        platform: "ios"
      }
    }
  );
  assert.equal(samePhone.company.deviceLimit, 1);
  assert.equal(samePhone.company.deviceUsed, 1);
  await apiJson(env, "/api/auth/logout", {
    method: "POST",
    authToken: samePhone.authToken,
    body: {}
  });
  const afterLogout = await apiJson<{ deviceUsed: number }>(
    env,
    "/api/devices",
    { authToken: tenant.authToken }
  );
  assert.equal(afterLogout.deviceUsed, 1);

  const full = await api(env, "/api/auth/login", {
    method: "POST",
    body: {
      account: "tenantquota",
      password: "secret123",
      deviceName: "Second iPhone",
      installationId: "tenantquota-second",
      platform: "ios"
    }
  });
  assert.equal(full.status, 409);
  const fullPayload = await full.json() as { code: string; deviceLimit: number; deviceUsed: number };
  assert.equal(fullPayload.code, "device_limit_reached");
  assert.equal(fullPayload.deviceLimit, 1);
  assert.equal(fullPayload.deviceUsed, 1);

  await apiJson(env, `/api/admin/companies/${tenant.company.id}/device-limit`, {
    method: "PATCH",
    token: "admin-token",
    body: { maxBoundDevices: 2 }
  });

  const raceBodies = ["tenantquota-second", "tenantquota-third"].map((installationId) => api(
    env,
    "/api/auth/login",
    {
      method: "POST",
      body: {
        account: "tenantquota",
        password: "secret123",
        deviceName: installationId,
        installationId,
        platform: "ios"
      }
    }
  ));
  const raceResponses = await Promise.all(raceBodies);
  assert.deepEqual(raceResponses.map((response) => response.status).sort(), [200, 409]);

  const deviceList = await apiJson<{
    deviceLimit: number;
    deviceUsed: number;
    devices: Array<{ id: string; installationId: string | null }>;
  }>(env, "/api/devices", { authToken: tenant.authToken });
  assert.equal(deviceList.deviceLimit, 2);
  assert.equal(deviceList.deviceUsed, 2);

  const removable = deviceList.devices.find((device) => device.installationId !== "tenantquota-device");
  assert.ok(removable);
  const lowerThanUsage = await api(env, `/api/admin/companies/${tenant.company.id}/device-limit`, {
    method: "PATCH",
    token: "admin-token",
    body: { maxBoundDevices: 1 }
  });
  assert.equal(lowerThanUsage.status, 409);
  const otherTenant = await registerTenant(env, "quotaother", "77889900");
  const crossTenantDelete = await api(env, `/api/devices/${removable.id}`, {
    method: "DELETE",
    authToken: otherTenant.authToken,
    body: { unbindCode: "00000000" }
  });
  assert.equal(crossTenantDelete.status, 404);
  const company = await env.DB.prepare(
    `SELECT unbind_code FROM companies WHERE id = ?`
  ).bind(tenant.company.id).first<{ unbind_code: string }>();
  await apiJson(env, `/api/devices/${removable.id}`, {
    method: "DELETE",
    authToken: tenant.authToken,
    body: { unbindCode: company?.unbind_code }
  });

  const afterRelease = await apiJson<{ deviceUsed: number }>(
    env,
    "/api/devices",
    { authToken: tenant.authToken }
  );
  assert.equal(afterRelease.deviceUsed, 1);

  await apiJson(env, `/api/admin/companies/${tenant.company.id}/device-limit`, {
    method: "PATCH",
    token: "admin-token",
    body: { maxBoundDevices: 3 }
  });
  for (const installationId of ["tenantquota-fourth", "tenantquota-fifth"]) {
    await apiJson(env, "/api/auth/login", {
      method: "POST",
      body: {
        account: "tenantquota",
        password: "secret123",
        deviceName: installationId,
        installationId,
        platform: "ios"
      }
    });
  }
  const quotaThreeFull = await api(env, "/api/auth/login", {
    method: "POST",
    body: {
      account: "tenantquota",
      password: "secret123",
      deviceName: "Sixth iPhone",
      installationId: "tenantquota-sixth",
      platform: "ios"
    }
  });
  assert.equal(quotaThreeFull.status, 409);
});

test("Worker integration: Amego issuance stores official payload once and creates a print job", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantinvoice", "24681357");
  await env.DB.prepare(
    `UPDATE companies SET amego_app_key = 'test-app-key' WHERE id = ?`
  ).bind(tenant.company.id).run();

  const originalFetch = globalThis.fetch;
  let amegoCallCount = 0;
  let postedInvoiceData: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    amegoCallCount += 1;
    const form = new URLSearchParams(String(init?.body));
    postedInvoiceData = JSON.parse(form.get("data") ?? "{}") as Record<string, unknown>;
    assert.equal(form.get("invoice"), "24681357");
    assert.match(form.get("sign") ?? "", /^[0-9a-f]{32}$/);
    return Response.json({
      code: 0,
      invoice_number: "CD12345678",
      invoice_date: "20260712",
      invoice_time: 1783800000,
      random_number: "5678",
      barcode: "11508CD123456785678",
      qrcode_left: "AMEGO-OFFICIAL-LEFT",
      qrcode_right: "**AMEGO-OFFICIAL-RIGHT",
      base64_data: "must-not-be-stored"
    });
  };

  try {
    const requestBody = amegoInvoiceBody("ORDER-20260712-001");
    const created = await apiJson<{
      status: string;
      invoiceId: string;
      invoiceNumber: string;
      printJobId: string;
    }>(
      env,
      "/api/invoices",
      { method: "POST", authToken: tenant.authToken, body: requestBody },
      201
    );
    assert.equal(created.status, "issued");
    assert.equal(created.invoiceNumber, "CD12345678");
    assert.ok(created.printJobId);
    assert.equal((postedInvoiceData as Record<string, unknown>).OrderId, "ORDER-20260712-001");
    assert.equal((postedInvoiceData as Record<string, unknown>).BuyerIdentifier, "0000000000");

    const replayed = await apiJson<{ invoiceId: string; printJobId: string }>(
      env,
      "/api/invoices",
      { method: "POST", authToken: tenant.authToken, body: requestBody },
      200
    );
    assert.equal(replayed.invoiceId, created.invoiceId);
    assert.equal(replayed.printJobId, created.printJobId);
    assert.equal(amegoCallCount, 1);

    const conflictingReplay = await api(env, "/api/invoices", {
      method: "POST",
      authToken: tenant.authToken,
      body: {
        ...requestBody,
        totalAmount: 50,
        items: [{ name: "奶茶", quantity: 1, unitPrice: 50 }]
      }
    });
    assert.equal(conflictingReplay.status, 409);
    assert.equal((await conflictingReplay.json() as { code: string }).code, "invoice_idempotency_conflict");
    assert.equal(amegoCallCount, 1);

    const stored = await env.DB.prepare(
      `SELECT status, amego_order_id, barcode_payload, qrcode_left, qrcode_right,
              sales_amount, tax_amount, amego_response_json
       FROM invoices
       WHERE id = ?`
    ).bind(created.invoiceId).first<{
      status: string;
      amego_order_id: string;
      barcode_payload: string;
      qrcode_left: string;
      qrcode_right: string;
      sales_amount: number;
      tax_amount: number;
      amego_response_json: string;
    }>();
    assert.equal(stored?.status, "issued");
    assert.equal(stored?.amego_order_id, "ORDER-20260712-001");
    assert.equal(stored?.barcode_payload, "11508CD123456785678");
    assert.equal(stored?.qrcode_left, "AMEGO-OFFICIAL-LEFT");
    assert.equal(stored?.qrcode_right, "**AMEGO-OFFICIAL-RIGHT");
    assert.equal(stored?.sales_amount, 45);
    assert.equal(stored?.tax_amount, 0);
    assert.equal(stored?.amego_response_json.includes("must-not-be-stored"), false);

    const job = await env.DB.prepare(
      `SELECT payload_json FROM print_jobs WHERE id = ?`
    ).bind(created.printJobId).first<{ payload_json: string }>();
    const payload = JSON.parse(job?.payload_json ?? "{}") as Record<string, unknown> & {
      leftQRCodePayload?: string;
      rightQRCodePayload?: string;
      barcodePayload?: string;
      salesAmount?: number;
      taxAmount?: number;
      invoiceFormatCode?: string;
    };
    assert.equal(payload.leftQRCodePayload, "AMEGO-OFFICIAL-LEFT");
    assert.equal(payload.rightQRCodePayload, "**AMEGO-OFFICIAL-RIGHT");
    assert.equal(payload.barcodePayload, "11508CD123456785678");
    assert.equal(payload.salesAmount, 45);
    assert.equal(payload.taxAmount, 0);
    assert.equal(payload.invoiceFormatCode, undefined);
    assert.equal("base64_data" in payload, false);
    assert.equal("base64Data" in payload, false);

    const claimed = await apiJson<{ jobs: Array<{ id: string }> }>(
      env,
      "/api/print-jobs/pending",
      { token: tenant.device.token }
    );
    assert.equal(claimed.jobs[0].id, created.printJobId);
    await apiJson(
      env,
      `/api/print-jobs/${created.printJobId}/failed`,
      { method: "POST", token: tenant.device.token, body: { message: "printer offline" } }
    );
    const replayAfterPrintFailure = await apiJson<{ invoiceId: string; printJobId: string }>(
      env,
      "/api/invoices",
      { method: "POST", authToken: tenant.authToken, body: requestBody }
    );
    assert.equal(replayAfterPrintFailure.invoiceId, created.invoiceId);
    assert.equal(replayAfterPrintFailure.printJobId, created.printJobId);
    assert.equal(amegoCallCount, 1);

    const unchanged = await env.DB.prepare(
      `SELECT barcode_payload, qrcode_left, qrcode_right FROM invoices WHERE id = ?`
    ).bind(created.invoiceId).first<{
      barcode_payload: string;
      qrcode_left: string;
      qrcode_right: string;
    }>();
    assert.deepEqual(unchanged, {
      barcode_payload: "11508CD123456785678",
      qrcode_left: "AMEGO-OFFICIAL-LEFT",
      qrcode_right: "**AMEGO-OFFICIAL-RIGHT"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker integration: unknown Amego result is queried and never reissued", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantrecover", "13572468");
  await env.DB.prepare(
    `UPDATE companies SET amego_app_key = 'test-app-key' WHERE id = ?`
  ).bind(tenant.company.id).run();

  const originalFetch = globalThis.fetch;
  const endpoints: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    endpoints.push(url);
    if (endpoints.length === 1) {
      throw new TypeError("connection lost after send");
    }
    if (endpoints.length === 2) {
      return Response.json({ code: 404, msg: "not found yet" });
    }
    return Response.json({
      code: 0,
      data: {
        invoice_number: "EF12345678",
        invoice_date: "20260712",
        invoice_time: "15:30:00",
        random_number: "9012",
        barcode: "11508EF123456789012",
        qrcode_left: "RECOVERED-LEFT",
        qrcode_right: "**RECOVERED-RIGHT"
      }
    });
  };

  try {
    const body = amegoInvoiceBody("ORDER-RECOVER-001");
    const unknown = await api(env, "/api/invoices", {
      method: "POST",
      authToken: tenant.authToken,
      body
    });
    assert.equal(unknown.status, 502);
    assert.equal((await unknown.json() as { code: string }).code, "amego_result_unknown");

    const issuance = await env.DB.prepare(
      `SELECT status FROM invoice_issuances WHERE company_id = ? AND order_id = ?`
    ).bind(tenant.company.id, "ORDER-RECOVER-001").first<{ status: string }>();
    assert.equal(issuance?.status, "issuing");

    const recovered = await apiJson<{ status: string; invoiceNumber: string }>(
      env,
      "/api/invoices",
      { method: "POST", authToken: tenant.authToken, body },
      200
    );
    assert.equal(recovered.status, "issued");
    assert.equal(recovered.invoiceNumber, "EF12345678");
    assert.equal(endpoints.filter((url) => url.endsWith("/f0401")).length, 1);
    assert.equal(endpoints.filter((url) => url.endsWith("/invoice_query")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker integration: Amego request validates destination and calculates B2B tax", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenanttax", "86421357");
  await env.DB.prepare(
    `UPDATE companies SET amego_app_key = 'test-app-key' WHERE id = ?`
  ).bind(tenant.company.id).run();

  const originalFetch = globalThis.fetch;
  const postedData: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const form = new URLSearchParams(String(init?.body));
    postedData.push(JSON.parse(form.get("data") ?? "{}") as Record<string, unknown>);
    const index = postedData.length;
    const invoiceNumbers = ["GH12345678", "IJ12345678", "KL12345678", "MN12345678"];
    const randomNumbers = ["1111", "2222", "3333", "4444"];
    return Response.json({
      code: 0,
      invoice_number: invoiceNumbers[index - 1],
      invoice_date: "20260712",
      invoice_time: 1783800000 + index,
      random_number: randomNumbers[index - 1],
      barcode: `11508${invoiceNumbers[index - 1]}${randomNumbers[index - 1]}`,
      qrcode_left: `LEFT-${index}`,
      qrcode_right: `**RIGHT-${index}`
    });
  };

  try {
    const conflict = await api(env, "/api/invoices", {
      method: "POST",
      authToken: tenant.authToken,
      body: {
        ...amegoInvoiceBody("ORDER-CONFLICT-001"),
        buyerIdentifier: "12345678",
        carrierType: "3J0002",
        carrierId: "/ABCD123"
      }
    });
    assert.equal(conflict.status, 400);
    assert.equal((await conflict.json() as { code: string }).code, "invoice_destination_conflict");
    assert.equal(postedData.length, 0);

    const businessInvoice = await apiJson<{ printJobId: string }>(
      env,
      "/api/invoices",
      {
        method: "POST",
        authToken: tenant.authToken,
        body: {
          orderId: "ORDER-B2B-001",
          buyerIdentifier: "12345678",
          buyerName: "測試買方公司",
          totalAmount: 105,
          items: [{ name: "顧問服務", quantity: 1, unitPrice: 105 }],
          print: false
        }
      },
      201
    );
    assert.ok(businessInvoice.printJobId);
    assert.equal(postedData[0].BuyerIdentifier, "12345678");
    assert.equal(postedData[0].BuyerName, "12345678");
    assert.equal(postedData[0].SalesAmount, "100");
    assert.equal(postedData[0].TaxAmount, "5");
    const businessJob = await env.DB.prepare(
      `SELECT payload_json FROM print_jobs WHERE id = ?`
    ).bind(businessInvoice.printJobId).first<{ payload_json: string }>();
    const businessPayload = JSON.parse(businessJob?.payload_json ?? "{}") as Record<string, unknown>;
    assert.equal(businessPayload.salesAmount, 100);
    assert.equal(businessPayload.taxAmount, 5);
    assert.equal(businessPayload.invoiceFormatCode, "25");

    const carrierInvoice = await apiJson<{ printJobId: string | null }>(
      env,
      "/api/invoices",
      {
        method: "POST",
        authToken: tenant.authToken,
        body: {
          ...amegoInvoiceBody("ORDER-CARRIER-001"),
          carrierType: "3J0002",
          carrierId: "/ABCD123"
        }
      },
      201
    );
    assert.equal(carrierInvoice.printJobId, null);
    assert.equal(postedData[1].CarrierType, "3J0002");
    assert.equal(postedData[1].CarrierId1, "/ABCD123");

    const donatedInvoice = await apiJson<{ printJobId: string | null }>(
      env,
      "/api/invoices",
      {
        method: "POST",
        authToken: tenant.authToken,
        body: { ...amegoInvoiceBody("ORDER-DONATION-001"), npoban: "001" }
      },
      201
    );
    assert.equal(donatedInvoice.printJobId, null);
    assert.equal(postedData[2].NPOBAN, "001");

    const multipleItems = await apiJson<{ printJobId: string }>(
      env,
      "/api/invoices",
      {
        method: "POST",
        authToken: tenant.authToken,
        body: {
          orderId: "ORDER-MULTI-001",
          totalAmount: 75,
          items: [
            { name: "奶茶", quantity: 1, unitPrice: 45 },
            { name: "加蛋", quantity: 2, unitPrice: 15 }
          ],
          print: true
        }
      },
      201
    );
    assert.ok(multipleItems.printJobId);
    assert.equal((postedData[3].ProductItem as unknown[]).length, 2);
    assert.equal(postedData[3].TotalAmount, "75");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker integration: explicit Amego rejection is failed and is not retried", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantreject", "97531864");
  await env.DB.prepare(
    `UPDATE companies SET amego_app_key = 'test-app-key' WHERE id = ?`
  ).bind(tenant.company.id).run();

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return Response.json({ code: 1001, msg: "invalid invoice data" });
  };

  try {
    const body = amegoInvoiceBody("ORDER-REJECT-001");
    const rejected = await api(env, "/api/invoices", {
      method: "POST",
      authToken: tenant.authToken,
      body
    });
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json() as { code: string }).code, "amego_invoice_rejected");

    const issuance = await env.DB.prepare(
      `SELECT status, error_code FROM invoice_issuances WHERE company_id = ? AND order_id = ?`
    ).bind(tenant.company.id, "ORDER-REJECT-001").first<{ status: string; error_code: string }>();
    assert.equal(issuance?.status, "failed");
    assert.equal(issuance?.error_code, "1001");

    const replayed = await api(env, "/api/invoices", {
      method: "POST",
      authToken: tenant.authToken,
      body
    });
    assert.equal(replayed.status, 409);
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker integration: invoice management query, reprint, void, audit, and tenant isolation", async () => {
  const env = await makeEnv();
  const tenant = await registerTenant(env, "tenantmanage", "31415926");
  const otherTenant = await registerTenant(env, "tenantother", "27182818");
  await env.DB.prepare(
    `UPDATE companies SET amego_app_key = 'test-app-key' WHERE id = ?`
  ).bind(tenant.company.id).run();

  const originalFetch = globalThis.fetch;
  const endpoints: string[] = [];
  let remoteVoided = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    endpoints.push(url);
    const form = new URLSearchParams(String(init?.body));
    const data = JSON.parse(form.get("data") ?? "{}") as unknown;
    if (url.endsWith("/f0501")) {
      assert.deepEqual(data, [{ CancelInvoiceNumber: "KL12345678" }]);
      return Response.json({ code: 0, msg: "voided" });
    }
    if (url.endsWith("/invoice_query")) {
      assert.deepEqual(data, { type: "invoice", invoice_number: "KL12345678" });
      return Response.json({
        code: 0,
        invoice_number: "KL12345678",
        invoice_type: "C0401",
        invoice_date: "20260712",
        invoice_time: "16:20:00",
        random_number: "3456",
        barcode: "11508KL123456783456",
        qrcode_left: "MANAGE-LEFT",
        qrcode_right: "**MANAGE-RIGHT",
        ...(remoteVoided ? { wait: [{ invoice_type: "C0501" }] } : {})
      });
    }
    return Response.json({
      code: 0,
      invoice_number: "KL12345678",
      invoice_date: "20260712",
      invoice_time: "16:20:00",
      random_number: "3456",
      barcode: "11508KL123456783456",
      qrcode_left: "MANAGE-LEFT",
      qrcode_right: "**MANAGE-RIGHT"
    });
  };

  try {
    const created = await apiJson<{ invoiceId: string; printJobId: string }>(
      env,
      "/api/invoices",
      { method: "POST", authToken: tenant.authToken, body: amegoInvoiceBody("ORDER-MANAGE-001") },
      201
    );

    const listed = await apiJson<{ invoices: Array<{ id: string; status: string }> }>(
      env,
      "/api/invoices",
      { authToken: tenant.authToken }
    );
    assert.equal(listed.invoices.find((invoice) => invoice.id === created.invoiceId)?.status, "print_pending");

    const isolatedDetail = await api(env, `/api/invoices/${created.invoiceId}`, {
      authToken: otherTenant.authToken
    });
    assert.equal(isolatedDetail.status, 404);

    await env.DB.prepare(
      `UPDATE invoices SET invoice_date = NULL WHERE id = ? AND company_id = ?`
    ).bind(created.invoiceId, tenant.company.id).run();
    const refreshed = await apiJson<{ invoice: { invoiceDate: string } }>(
      env,
      `/api/invoices/${created.invoiceId}/refresh`,
      { method: "POST", authToken: tenant.authToken, body: {} }
    );
    assert.equal(refreshed.invoice.invoiceDate, "20260712");

    const reprint = await apiJson<{ printJobId: string }>(
      env,
      `/api/invoices/${created.invoiceId}/reprint`,
      { method: "POST", authToken: tenant.authToken, body: {} },
      201
    );
    assert.notEqual(reprint.printJobId, created.printJobId);
    const reprintRow = await env.DB.prepare(
      `SELECT payload_json FROM print_jobs WHERE id = ? AND company_id = ? AND invoice_id = ?`
    ).bind(reprint.printJobId, tenant.company.id, created.invoiceId).first<{ payload_json: string }>();
    const reprintPayload = JSON.parse(reprintRow?.payload_json ?? "{}") as Record<string, unknown>;
    assert.equal(reprintPayload.barcodePayload, "11508KL123456783456");
    assert.equal(reprintPayload.leftQRCodePayload, "MANAGE-LEFT");
    assert.equal(reprintPayload.rightQRCodePayload, "**MANAGE-RIGHT");
    assert.equal(reprintPayload.salesAmount, 45);
    assert.equal(reprintPayload.taxAmount, 0);
    assert.equal(reprintPayload.invoiceFormatCode, undefined);
    assert.equal(reprintPayload.isReprint, true);

    remoteVoided = true;
    const blockedReprint = await api(
      env,
      `/api/invoices/${created.invoiceId}/reprint`,
      { method: "POST", authToken: tenant.authToken, body: {} }
    );
    assert.equal(blockedReprint.status, 409);
    assert.equal((await blockedReprint.json() as { code: string }).code, "invoice_voided");

    await apiJson(
      env,
      `/api/invoices/${created.invoiceId}/void`,
      { method: "POST", authToken: tenant.authToken, body: {} }
    );
    const voided = await apiJson<{ invoice: { status: string; voidedAt: string } }>(
      env,
      `/api/invoices/${created.invoiceId}`,
      { authToken: tenant.authToken }
    );
    assert.equal(voided.invoice.status, "voided");
    assert.ok(voided.invoice.voidedAt);

    const stoppedJobs = await env.DB.prepare(
      `SELECT status, last_error FROM print_jobs WHERE invoice_id = ? ORDER BY created_at ASC`
    ).bind(created.invoiceId).all<{ status: string; last_error: string }>();
    assert.equal(stoppedJobs.results.length, 2);
    assert.equal(stoppedJobs.results.every((job) => job.status === "failed" && job.last_error === "invoice_voided"), true);

    const actions = await env.DB.prepare(
      `SELECT action FROM audit_logs WHERE company_id = ? AND target_id = ? ORDER BY created_at ASC`
    ).bind(tenant.company.id, created.invoiceId).all<{ action: string }>();
    assert.equal(actions.results.some((row) => row.action === "invoice.query.completed"), true);
    assert.equal(actions.results.some((row) => row.action === "invoice.reprint.created"), true);
    assert.equal(actions.results.some((row) => row.action === "invoice.void.completed"), true);
    assert.equal(endpoints.filter((url) => url.endsWith("/invoice_query")).length, 3);
    assert.equal(endpoints.filter((url) => url.endsWith("/f0501")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

async function hashAdminTokenForTest(token: string): Promise<string> {
  return sha256HexForTest(`admin:${token}`);
}

async function sha256HexForTest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function amegoInvoiceBody(orderId: string) {
  return {
    orderId,
    totalAmount: 45,
    items: [{ name: "奶茶", quantity: 1, unitPrice: 45 }],
    print: true
  };
}
