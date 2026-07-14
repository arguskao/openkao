import { generateSessionToken, issueDeviceTokenStorageValue, requireOwnerAccess } from "./auth";
import { hashDeviceToken } from "./crypto-utils";
import type { DeviceIdentity, DeviceSession, ManagedDeviceRow, UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import {
  normalizeDeviceName,
  normalizeDevicePlatform,
  normalizeOptionalInstallationId,
  normalizeOptionalString,
  parseManagedDeviceBody,
  parseManagedDeviceUpdateBody,
  parsePositiveId
} from "./request-parsers";
import type { Env, RequestContext } from "./types";
import { readJson, requireString } from "./validation";

type UserAuditWriter = (
  env: Env,
  session: UserSession,
  targetType: string,
  targetId: string,
  action: string,
  details?: Record<string, unknown> | null
) => Promise<void>;

type SystemAuditWriter = (
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
) => Promise<void>;

export async function registerDevice(
  request: Request,
  env: Env,
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter
): Promise<Response> {
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

export async function getDeviceMe(env: Env, device: DeviceSession): Promise<Response> {
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

export async function listManagedDevices(env: Env, session: UserSession): Promise<Response> {
  requireOwnerAccess(session);
  const quota = await fetchCompanyDeviceQuota(env, session.company_id);

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
    devices: result.results.map(mapManagedDeviceRow),
    deviceLimit: quota.limit,
    deviceUsed: quota.used
  });
}

export async function createManagedDevice(
  request: Request,
  env: Env,
  session: UserSession,
  writeAuditLog: UserAuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const input = parseManagedDeviceBody(await readJson<Record<string, unknown>>(request));

  const name = normalizeDeviceName(input.name);
  const platform = normalizeDevicePlatform(input.platform);
  const installationId = normalizeOptionalInstallationId(input.installationId);
  const id = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);

  if (installationId) {
    await insertBoundDeviceWithinQuota(env, {
      id,
      companyId: session.company_id,
      name,
      platform,
      installationId,
      tokenHash
    });
  } else {
    await env.DB.prepare(
      `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
      .bind(id, session.company_id, name, issueDeviceTokenStorageValue(id), tokenHash, platform)
      .run();
  }

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

export async function updateManagedDevice(
  request: Request,
  env: Env,
  session: UserSession,
  deviceIdValue: string,
  writeAuditLog: UserAuditWriter
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

export async function rotateManagedDeviceToken(
  env: Env,
  session: UserSession,
  deviceIdValue: string,
  writeAuditLog: UserAuditWriter
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

export async function revokeManagedDevice(
  request: Request,
  env: Env,
  session: UserSession,
  deviceIdValue: string,
  writeAuditLog: UserAuditWriter
): Promise<Response> {
  requireOwnerAccess(session);

  const device = await fetchManagedDeviceById(env, session.company_id, deviceIdValue);
  const input = await readJson<{ unbindCode?: string }>(request);
  const expectedCode = await fetchCompanyUnbindCode(env, session.company_id);
  if (!expectedCode || input.unbindCode?.trim() !== expectedCode) {
    throw new HttpError(403, "unbind_code_invalid");
  }

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

export async function ensureCompanyDevice(
  env: Env,
  companyId: number,
  deviceName: string,
  platform: string,
  installationId: string,
  unbindCode?: string | null,
  expectedUnbindCode?: string | null
): Promise<DeviceIdentity> {
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

  const id = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashDeviceToken(token);
  const quota = await fetchCompanyDeviceQuota(env, companyId);

  if (quota.used >= quota.limit) {
    const companyUnbindCode = expectedUnbindCode ?? await fetchCompanyUnbindCode(env, companyId);
    if (quota.used === 1 && companyUnbindCode && unbindCode?.trim() === companyUnbindCode) {
      const oldDevice = await fetchPrimaryBoundCompanyDevice(env, companyId);
      if (oldDevice) {
        await replaceCompanyDevice(env, oldDevice.id, {
          id,
          companyId,
          name: deviceName,
          platform,
          installationId,
          tokenHash
        });
        return { id, token, name: deviceName };
      }
    } else {
      throw deviceLimitError(quota);
    }
  }

  await insertBoundDeviceWithinQuota(env, {
    id,
    companyId,
    name: deviceName,
    platform,
    installationId,
    tokenHash
  });

  return {
    id,
    token,
    name: deviceName
  };
}

export async function fetchPrimaryCompanyDevice(
  env: Env,
  companyId: number,
  createIfMissing = true
): Promise<DeviceIdentity | null> {
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

export async function fetchCompanyDeviceById(
  env: Env,
  companyId: number,
  deviceId: string
): Promise<DeviceIdentity | null> {
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

async function fetchPrimaryBoundCompanyDevice(env: Env, companyId: number): Promise<DeviceIdentity | null> {
  return env.DB.prepare(
    `SELECT id, name
     FROM devices
     WHERE company_id = ?
       AND installation_id IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`
  ).bind(companyId).first<DeviceIdentity>();
}

async function replaceCompanyDevice(
  env: Env,
  oldDeviceId: string,
  input: {
    id: string;
    companyId: number;
    name: string;
    platform: string;
    installationId: string;
    tokenHash: string;
  }
): Promise<void> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE company_id = ?
         AND device_id = ?
         AND revoked_at IS NULL`
    ).bind(input.companyId, oldDeviceId),
    env.DB.prepare(
      `DELETE FROM devices
       WHERE company_id = ? AND id = ?`
    ).bind(input.companyId, oldDeviceId),
    env.DB.prepare(
      `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
       SELECT ?, c.id, ?, ?, ?, ?, ?
       FROM companies c
       WHERE c.id = ?
         AND (
           SELECT COUNT(*)
           FROM devices d
           WHERE d.company_id = c.id
             AND d.installation_id IS NOT NULL
         ) < c.max_bound_devices`
    ).bind(
      input.id,
      input.name,
      issueDeviceTokenStorageValue(input.id),
      input.tokenHash,
      input.platform,
      input.installationId,
      input.companyId
    )
  ]);

  if (results[2]?.meta.changes === 0) {
    throw deviceLimitError(await fetchCompanyDeviceQuota(env, input.companyId));
  }
}

export async function fetchCompanyDeviceQuota(
  env: Env,
  companyId: number
): Promise<{ limit: number; used: number }> {
  const row = await env.DB.prepare(
    `SELECT
       c.max_bound_devices AS device_limit,
       (
         SELECT COUNT(*)
         FROM devices d
         WHERE d.company_id = c.id
           AND d.installation_id IS NOT NULL
       ) AS device_used
     FROM companies c
     WHERE c.id = ?`
  ).bind(companyId).first<{ device_limit: number; device_used: number }>();
  if (!row) throw new HttpError(404, "company_not_found");
  return { limit: Number(row.device_limit), used: Number(row.device_used) };
}

async function insertBoundDeviceWithinQuota(
  env: Env,
  input: {
    id: string;
    companyId: number;
    name: string;
    platform: string;
    installationId: string;
    tokenHash: string;
  }
): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO devices (id, company_id, name, token, token_hash, platform, installation_id)
     SELECT ?, c.id, ?, ?, ?, ?, ?
     FROM companies c
     WHERE c.id = ?
       AND (
         SELECT COUNT(*)
         FROM devices d
         WHERE d.company_id = c.id
           AND d.installation_id IS NOT NULL
       ) < c.max_bound_devices`
  ).bind(
    input.id,
    input.name,
    issueDeviceTokenStorageValue(input.id),
    input.tokenHash,
    input.platform,
    input.installationId,
    input.companyId
  ).run();

  if (result.meta.changes === 0) {
    throw deviceLimitError(await fetchCompanyDeviceQuota(env, input.companyId));
  }
}

function deviceLimitError(quota: { limit: number; used: number }): HttpError {
  return new HttpError(409, "device_limit_reached", {
    details: {
      deviceLimit: quota.limit,
      deviceUsed: quota.used
    }
  });
}
