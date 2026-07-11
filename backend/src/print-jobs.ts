import { leaseExpiryTimestamp } from "./auth";
import { MAX_INVOICE_ITEMS, MAX_ITEM_QUANTITY, MAX_MONEY_AMOUNT } from "./constants";
import { sha256Hex } from "./crypto-utils";
import type { DeviceSession, PrintJobPayload, PrintJobRow } from "./domain-types";
import { HttpError, json } from "./http";
import {
  normalizeCompanyIdentifier,
  normalizeInvoiceNumber,
  normalizeIssuedAt,
  normalizeOptionalBoundedString,
  normalizeOptionalCompanyIdentifier,
  normalizePrintStatusValue,
  normalizeRandomNumber,
  normalizeRequiredBoundedString,
  parseCreatePrintJobBody,
  parsePayload,
  parsePositiveId,
  parsePrintJobStatusBody
} from "./request-parsers";
import type { Env, RequestContext } from "./types";
import { readJson, requireArray, requireIntegerRange } from "./validation";

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

export async function checkPrintJobQueueHealth(env: Env): Promise<void> {
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

export async function listPendingPrintJobs(
  env: Env,
  device: DeviceSession,
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter
): Promise<Response> {
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

export async function getPrintJob(env: Env, device: DeviceSession, id: string): Promise<Response> {
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

export async function updatePrintJobStatus(
  env: Env,
  device: DeviceSession,
  id: string,
  status: "printed" | "failed",
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter,
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

export async function adminListPrintJobs(env: Env): Promise<Response> {
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

export async function adminReleasePrintJob(
  env: Env,
  id: string,
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter
): Promise<Response> {
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

export async function createPrintJob(
  request: Request,
  env: Env,
  context: RequestContext,
  writeSystemAuditLog: SystemAuditWriter
): Promise<Response> {
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
  requireIntegerRange(input.totalAmount, "totalAmount", { min: 0, max: MAX_MONEY_AMOUNT });
  requireArray(input.items, "items", { min: 1, max: MAX_INVOICE_ITEMS });

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
    requireIntegerRange(item.quantity, "item.quantity", { min: 1, max: MAX_ITEM_QUANTITY });
    requireIntegerRange(item.unitPrice, "item.unitPrice", { min: 0, max: MAX_MONEY_AMOUNT });
    const amount = item.quantity * item.unitPrice;
    requireIntegerRange(amount, "item.amount", { min: 0, max: MAX_MONEY_AMOUNT });
    return {
      id: crypto.randomUUID(),
      name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount
    };
  });

  const calculatedTotalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  requireIntegerRange(calculatedTotalAmount, "totalAmount", { min: 0, max: MAX_MONEY_AMOUNT });
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
