import { normalizeAccount, normalizeUserRole, requirePassword } from "./auth";
import { verifyPassword } from "./crypto-utils";
import type { UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import type { Env } from "./types";
import { readJson } from "./validation";

type AccountPasswordRow = {
  password_hash: string | null;
};

type AccountCredentialsRow = {
  id: number;
  company_id: number | null;
  role: string | null;
  password_hash: string | null;
};

type DeletionIdentity = {
  userId: number;
  companyId: number;
  role: string;
};

export async function deleteOwnAccount(
  request: Request,
  env: Env,
  session: UserSession
): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  const password = typeof input.password === "string" ? input.password : "";
  requirePassword(password);

  const account = await env.DB.prepare(
    `SELECT password_hash
     FROM users
     WHERE id = ? AND company_id = ? AND is_active = 1`
  )
    .bind(session.user_id, session.company_id)
    .first<AccountPasswordRow>();

  if (!account?.password_hash || !(await verifyPassword(password, account.password_hash))) {
    throw new HttpError(401, "invalid_credentials");
  }

  return deleteAccountData(env, {
    userId: session.user_id,
    companyId: session.company_id,
    role: session.role
  });
}

export async function deleteAccountWithCredentials(request: Request, env: Env): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  const account = normalizeAccount(String(input.account ?? ""));
  const password = typeof input.password === "string" ? input.password : "";
  requirePassword(password);

  const row = await env.DB.prepare(
    `SELECT id, company_id, role, password_hash
     FROM users
     WHERE lower(email) = ?`
  )
    .bind(account)
    .first<AccountCredentialsRow>();

  if (!row?.company_id || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, "invalid_credentials");
  }

  return deleteAccountData(env, {
    userId: row.id,
    companyId: row.company_id,
    role: row.role ?? "staff"
  });
}

async function deleteAccountData(env: Env, identity: DeletionIdentity): Promise<Response> {
  if (normalizeUserRole(identity.role) === "owner") {
    // The company owns all tenant-scoped data. Its foreign keys cascade to
    // users, sessions, devices, catalog data, invoices, jobs, and audit logs.
    await env.DB.prepare(
      `DELETE FROM companies
       WHERE id = ?`
    )
      .bind(identity.companyId)
      .run();

    return json({ ok: true, deletedScope: "company" });
  }

  await env.DB.batch([
    // Remove devices that were used only by this account so their device
    // tokens cannot continue accessing the company after account deletion.
    env.DB.prepare(
      `DELETE FROM devices
       WHERE company_id = ?
         AND id IN (
           SELECT device_id
           FROM auth_sessions
           WHERE user_id = ?
             AND company_id = ?
             AND device_id IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1
           FROM auth_sessions other
           WHERE other.device_id = devices.id
             AND other.user_id != ?
         )`
    ).bind(identity.companyId, identity.userId, identity.companyId, identity.userId),
    // Membership and failed-login audit entries can contain the account's
    // name, phone, or account value in their details payload.
    env.DB.prepare(
      `DELETE FROM audit_logs
       WHERE company_id = ?
         AND target_id = ?
         AND target_type IN ('user', 'auth')`
    ).bind(identity.companyId, String(identity.userId)),
    env.DB.prepare(
      `DELETE FROM users
       WHERE id = ?
         AND company_id = ?
         AND role != 'owner'`
    ).bind(identity.userId, identity.companyId)
  ]);

  return json({ ok: true, deletedScope: "user" });
}
