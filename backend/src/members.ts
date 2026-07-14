import { normalizeAccount, requireOwnerAccess, requirePassword } from "./auth";
import { hashPassword } from "./crypto-utils";
import type { UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import { normalizeOptionalString, normalizeRequiredBoundedString, parsePositiveId } from "./request-parsers";
import type { Env } from "./types";
import { readJson } from "./validation";

type AuditWriter = (
  env: Env,
  session: UserSession,
  targetType: string,
  targetId: string,
  action: string,
  details?: Record<string, unknown> | null
) => Promise<void>;

type StaffRow = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export async function listStaffMembers(env: Env, session: UserSession, url: URL): Promise<Response> {
  requireOwnerAccess(session);
  const includeInactive = url.searchParams.get("includeInactive") === "true";

  const result = await env.DB.prepare(
    `SELECT id, email, name, phone, is_active, created_at, updated_at
     FROM users
     WHERE company_id = ?
       AND role = 'staff'
       AND (? = 1 OR is_active = 1)
     ORDER BY is_active DESC, name ASC, id ASC`
  )
    .bind(session.company_id, includeInactive ? 1 : 0)
    .all<StaffRow>();

  return json({ members: result.results.map(mapStaffRow) });
}

export async function createStaffMember(
  request: Request,
  env: Env,
  session: UserSession,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const input = await readJson<Record<string, unknown>>(request);
  const account = normalizeAccount(String(input.account ?? ""));
  const name = normalizeRequiredBoundedString(input.name, "name", 80);
  const phone = normalizeOptionalString(input.phone);
  const password = String(input.password ?? "");
  requirePassword(password);

  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE lower(email) = ?`
  ).bind(account).first<{ id: number }>();
  if (existing) throw new HttpError(409, "account_already_registered");

  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    `INSERT INTO users (id, company_id, email, password_hash, name, phone, role, is_active)
     VALUES (NULL, ?, ?, ?, ?, ?, 'staff', 1)`
  ).bind(session.company_id, account, passwordHash, name, phone).run();
  const id = Number(result.meta.last_row_id);

  await writeAuditLog(env, session, "user", String(id), "staff.create", {
    account,
    name,
    phone
  });

  return json({ member: await fetchStaff(env, session.company_id, id) }, 201);
}

export async function updateStaffMember(
  request: Request,
  env: Env,
  session: UserSession,
  userIdValue: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const userId = parsePositiveId(userIdValue, "userId");
  const previous = await fetchStaff(env, session.company_id, userId);
  const input = await readJson<Record<string, unknown>>(request);
  const name = input.name == null
    ? previous.name
    : normalizeRequiredBoundedString(input.name, "name", 80);
  const phone = input.phone === undefined ? previous.phone : normalizeOptionalString(input.phone);
  const isActive = input.isActive === undefined ? previous.isActive : normalizeBoolean(input.isActive, "isActive");

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET name = ?, phone = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND role = 'staff'`
    ).bind(name, phone, isActive ? 1 : 0, userId, session.company_id),
    ...(isActive ? [] : [env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL`
    ).bind(userId, session.company_id)])
  ]);

  await writeAuditLog(env, session, "user", String(userId), isActive ? "staff.update" : "staff.disable", {
    previousName: previous.name,
    name,
    previousPhone: previous.phone,
    phone,
    previousIsActive: previous.isActive,
    isActive,
    revokedSessions: !isActive
  });

  return json({ member: await fetchStaff(env, session.company_id, userId) });
}

export async function deleteStaffMember(
  env: Env,
  session: UserSession,
  userIdValue: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const userId = parsePositiveId(userIdValue, "userId");
  const member = await fetchStaff(env, session.company_id, userId);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND role = 'staff'`
    ).bind(userId, session.company_id),
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL`
    ).bind(userId, session.company_id)
  ]);

  await writeAuditLog(env, session, "user", String(userId), "staff.delete", {
    account: member.account,
    revokedSessions: true,
    softDeleted: true
  });

  return json({ ok: true, userId });
}

export async function resetStaffPassword(
  request: Request,
  env: Env,
  session: UserSession,
  userIdValue: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const userId = parsePositiveId(userIdValue, "userId");
  await fetchStaff(env, session.company_id, userId);
  const input = await readJson<Record<string, unknown>>(request);
  const password = String(input.password ?? "");
  requirePassword(password);
  const passwordHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND role = 'staff'`
    ).bind(passwordHash, userId, session.company_id),
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL`
    ).bind(userId, session.company_id)
  ]);

  await writeAuditLog(env, session, "user", String(userId), "staff.reset_password", {
    revokedSessions: true
  });

  return json({ ok: true, userId });
}

async function fetchStaff(env: Env, companyId: number, userId: number) {
  const row = await env.DB.prepare(
    `SELECT id, email, name, phone, is_active, created_at, updated_at
     FROM users
     WHERE id = ? AND company_id = ? AND role = 'staff'`
  ).bind(userId, companyId).first<StaffRow>();
  if (!row) throw new HttpError(404, "staff_not_found");
  return mapStaffRow(row);
}

function mapStaffRow(row: StaffRow) {
  return {
    id: row.id,
    account: row.email,
    name: row.name ?? "",
    phone: row.phone,
    role: "staff" as const,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new HttpError(400, `${field}_invalid`);
}
