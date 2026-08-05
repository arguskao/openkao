import {
  AmegoTransportError,
  queryAmegoInvoiceStatus,
  requestAmegoInvoicePrint,
  type AmegoInvoicePrintType
} from "./amego";
import {
  amegoInvoiceStatusAuditDetails,
  requireAmegoInvoiceIssued
} from "./amego-invoice-state";
import { HttpError } from "./http";
import type { Env } from "./types";

const DEFAULT_PRINTER_TYPE = 2;
const DEFAULT_PRINTER_LANG = 2;
const MAX_SYNC_ATTEMPTS = 10;
const MAX_BATCH_SIZE = 25;
const PERMANENT_PRINT_CODES = new Set(["35", "51", "53", "55", "56", "71", "72"]);

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

type AmegoPrintSyncStatus = "not_required" | "pending" | "synced" | "manual_review";

type SyncJobRow = {
  id: string;
  company_id: number;
  invoice_id: string | null;
  status: string;
  payload_json: string;
  amego_print_sync_status: AmegoPrintSyncStatus;
  amego_print_attempt_count: number;
  invoice_number: string;
  invoice_record_status: string;
  total_amount: number;
  amego_order_id: string | null;
  carrier_type: string | null;
  npoban: string | null;
  tax_id: string;
  amego_invoice_no: string | null;
  amego_app_key: string | null;
  amego_printer_type: number | null;
  amego_printer_lang: number | null;
};

export async function syncAmegoPrintJob(
  env: Env,
  jobId: string,
  writeSystemAuditLog?: SystemAuditWriter,
  actorDeviceId: string | null = null
): Promise<AmegoPrintSyncStatus> {
  const row = await fetchSyncJob(env, jobId);
  if (!row) return "not_required";
  if (row.status !== "printed" || row.amego_print_sync_status !== "pending") {
    return row.amego_print_sync_status;
  }

  const claimed = await claimSyncAttempt(env, row.id, row.company_id);
  if (!claimed) {
    return currentSyncStatus(env, row.id, row.company_id);
  }

  const attempt = row.amego_print_attempt_count + 1;
  const printInvoiceType = parsePrintInvoiceType(row.payload_json);
  if (!row.invoice_id || !row.amego_order_id) {
    return markManualReview(env, row, attempt, "amego_invoice_not_official", writeSystemAuditLog, actorDeviceId);
  }
  if (row.invoice_record_status !== "issued") {
    return markManualReview(env, row, attempt, "invoice_not_issued", writeSystemAuditLog, actorDeviceId);
  }
  if (row.total_amount === 0) {
    return markManualReview(env, row, attempt, "amego_zero_amount_not_printable", writeSystemAuditLog, actorDeviceId);
  }
  if (hasValue(row.carrier_type) || hasValue(row.npoban)) {
    return markManualReview(env, row, attempt, "amego_paper_print_not_allowed", writeSystemAuditLog, actorDeviceId);
  }

  const appKey = row.amego_app_key?.trim();
  if (!appKey) {
    return markManualReview(env, row, attempt, "amego_app_key_not_configured", writeSystemAuditLog, actorDeviceId);
  }
  const invoiceAccount = row.amego_invoice_no?.trim() || row.tax_id.trim();

  let remoteStatus;
  try {
    remoteStatus = await queryAmegoInvoiceStatus({
      invoice: invoiceAccount,
      appKey,
      invoiceNumber: row.invoice_number,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
  } catch (error) {
    if (!(error instanceof AmegoTransportError)) throw error;
    return markRetryOrReview(
      env,
      row,
      attempt,
      error.code,
      writeSystemAuditLog,
      actorDeviceId
    );
  }

  try {
    requireAmegoInvoiceIssued(remoteStatus, row.invoice_number);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.code === "amego_invoice_change_pending" || error.code === "amego_invoice_status_unavailable") {
      return markRetryOrReview(env, row, attempt, error.code, writeSystemAuditLog, actorDeviceId);
    }
    return markManualReview(env, row, attempt, error.code, writeSystemAuditLog, actorDeviceId);
  }

  await audit(writeSystemAuditLog, env, row, actorDeviceId, "amego.print_sync.status_checked", {
    ...amegoInvoiceStatusAuditDetails(remoteStatus, "print_sync"),
    printInvoiceType
  });

  if (printInvoiceType === 1 && remoteStatus.printMark?.toUpperCase() === "Y") {
    return markSynced(env, row, attempt, "already_marked_printed", writeSystemAuditLog, actorDeviceId);
  }

  let printResult;
  try {
    printResult = await requestAmegoInvoicePrint({
      invoice: invoiceAccount,
      appKey,
      invoiceNumber: row.invoice_number,
      printerType: row.amego_printer_type ?? DEFAULT_PRINTER_TYPE,
      printerLang: row.amego_printer_lang ?? DEFAULT_PRINTER_LANG,
      printInvoiceType,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
  } catch (error) {
    if (!(error instanceof AmegoTransportError)) throw error;
    return markRetryOrReview(
      env,
      row,
      attempt,
      error.code,
      writeSystemAuditLog,
      actorDeviceId
    );
  }

  if (printResult.code === "0") {
    return markSynced(env, row, attempt, "invoice_print_accepted", writeSystemAuditLog, actorDeviceId);
  }
  if (printResult.code === "52") {
    return markRetryOrReview(
      env,
      row,
      attempt,
      `amego_print_${printResult.code}`,
      writeSystemAuditLog,
      actorDeviceId
    );
  }
  if (PERMANENT_PRINT_CODES.has(printResult.code)) {
    return markManualReview(
      env,
      row,
      attempt,
      `amego_print_${printResult.code}`,
      writeSystemAuditLog,
      actorDeviceId
    );
  }
  return markRetryOrReview(
    env,
    row,
    attempt,
    `amego_print_${printResult.code || "invalid_response"}`,
    writeSystemAuditLog,
    actorDeviceId
  );
}

export async function syncPendingAmegoPrintJobs(
  env: Env,
  writeSystemAuditLog?: SystemAuditWriter
): Promise<void> {
  const jobs = await env.DB.prepare(
    `SELECT id
     FROM print_jobs
     WHERE status = 'printed'
       AND amego_print_sync_status = 'pending'
       AND (amego_print_next_retry_at IS NULL OR amego_print_next_retry_at <= CURRENT_TIMESTAMP)
     ORDER BY COALESCE(amego_print_next_retry_at, created_at) ASC, created_at ASC
     LIMIT ?`
  ).bind(MAX_BATCH_SIZE).all<{ id: string }>();

  for (const job of jobs.results) {
    try {
      await syncAmegoPrintJob(env, job.id, writeSystemAuditLog);
    } catch (error) {
      console.error(JSON.stringify({
        event: "amego.print_sync.unhandled_error",
        printJobId: job.id,
        error: error instanceof Error ? error.message : "unknown_error"
      }));
    }
  }
}

async function fetchSyncJob(env: Env, jobId: string): Promise<SyncJobRow | null> {
  return env.DB.prepare(
    `SELECT pj.id, pj.company_id, pj.invoice_id, pj.status, pj.payload_json,
            pj.amego_print_sync_status, pj.amego_print_attempt_count,
            i.invoice_number, i.status AS invoice_record_status, i.total_amount,
            i.amego_order_id, i.carrier_type, i.npoban,
            c.tax_id, c.amego_invoice_no, c.amego_app_key,
            c.amego_printer_type, c.amego_printer_lang
     FROM print_jobs pj
     JOIN invoices i ON i.id = pj.invoice_id AND i.company_id = pj.company_id
     JOIN companies c ON c.id = pj.company_id
     WHERE pj.id = ?`
  ).bind(jobId).first<SyncJobRow>();
}

async function claimSyncAttempt(env: Env, jobId: string, companyId: number): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.now() + 2 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const result = await env.DB.prepare(
    `UPDATE print_jobs
     SET amego_print_next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND company_id = ?
       AND status = 'printed'
       AND amego_print_sync_status = 'pending'
       AND (amego_print_next_retry_at IS NULL OR amego_print_next_retry_at <= CURRENT_TIMESTAMP)`
  ).bind(leaseExpiresAt, jobId, companyId).run();
  return result.meta.changes === 1;
}

async function currentSyncStatus(
  env: Env,
  jobId: string,
  companyId: number
): Promise<AmegoPrintSyncStatus> {
  const row = await env.DB.prepare(
    `SELECT amego_print_sync_status
     FROM print_jobs
     WHERE id = ? AND company_id = ?`
  ).bind(jobId, companyId).first<{ amego_print_sync_status: AmegoPrintSyncStatus }>();
  return row?.amego_print_sync_status ?? "not_required";
}

function parsePrintInvoiceType(payloadJson: string): AmegoInvoicePrintType {
  try {
    const payload = JSON.parse(payloadJson) as { isReprint?: unknown };
    return payload.isReprint === true ? 2 : 1;
  } catch {
    return 1;
  }
}

async function markSynced(
  env: Env,
  row: SyncJobRow,
  attempt: number,
  reason: string,
  writeSystemAuditLog?: SystemAuditWriter,
  actorDeviceId: string | null = null
): Promise<"synced"> {
  await env.DB.prepare(
    `UPDATE print_jobs
     SET amego_print_sync_status = 'synced',
         amego_print_attempt_count = ?,
         amego_print_last_error = NULL,
         amego_print_next_retry_at = NULL,
         amego_print_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ? AND amego_print_sync_status = 'pending'`
  ).bind(attempt, row.id, row.company_id).run();
  console.info(JSON.stringify({
    event: "amego.print_sync.completed",
    companyId: row.company_id,
    invoiceId: row.invoice_id,
    printJobId: row.id,
    attempt,
    reason
  }));
  await audit(writeSystemAuditLog, env, row, actorDeviceId, "amego.print_sync.completed", {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    attempt,
    reason
  });
  return "synced";
}

async function markRetryOrReview(
  env: Env,
  row: SyncJobRow,
  attempt: number,
  errorCode: string,
  writeSystemAuditLog?: SystemAuditWriter,
  actorDeviceId: string | null = null
): Promise<"pending" | "manual_review"> {
  if (attempt >= MAX_SYNC_ATTEMPTS) {
    return markManualReview(env, row, attempt, errorCode, writeSystemAuditLog, actorDeviceId);
  }
  const nextRetryAt = retryTimestamp(attempt);
  await env.DB.prepare(
    `UPDATE print_jobs
     SET amego_print_attempt_count = ?,
         amego_print_last_error = ?,
         amego_print_next_retry_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ? AND amego_print_sync_status = 'pending'`
  ).bind(attempt, errorCode.slice(0, 200), nextRetryAt, row.id, row.company_id).run();
  console.warn(JSON.stringify({
    event: "amego.print_sync.retry_scheduled",
    companyId: row.company_id,
    invoiceId: row.invoice_id,
    printJobId: row.id,
    attempt,
    nextRetryAt,
    errorCode
  }));
  await audit(writeSystemAuditLog, env, row, actorDeviceId, "amego.print_sync.retry_scheduled", {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    attempt,
    nextRetryAt,
    errorCode
  });
  return "pending";
}

async function markManualReview(
  env: Env,
  row: SyncJobRow,
  attempt: number,
  errorCode: string,
  writeSystemAuditLog?: SystemAuditWriter,
  actorDeviceId: string | null = null
): Promise<"manual_review"> {
  await env.DB.prepare(
    `UPDATE print_jobs
     SET amego_print_sync_status = 'manual_review',
         amego_print_attempt_count = ?,
         amego_print_last_error = ?,
         amego_print_next_retry_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ? AND amego_print_sync_status = 'pending'`
  ).bind(attempt, errorCode.slice(0, 200), row.id, row.company_id).run();
  console.warn(JSON.stringify({
    event: "amego.print_sync.manual_review",
    companyId: row.company_id,
    invoiceId: row.invoice_id,
    printJobId: row.id,
    attempt,
    errorCode
  }));
  await audit(writeSystemAuditLog, env, row, actorDeviceId, "amego.print_sync.manual_review", {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    attempt,
    errorCode
  });
  return "manual_review";
}

async function audit(
  writeSystemAuditLog: SystemAuditWriter | undefined,
  env: Env,
  row: SyncJobRow,
  actorDeviceId: string | null,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  if (!writeSystemAuditLog) return;
  await writeSystemAuditLog(env, {
    companyId: row.company_id,
    actorDeviceId,
    targetType: "print_job",
    targetId: row.id,
    action,
    details
  });
}

function retryTimestamp(attempt: number): string {
  const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + delaySeconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function hasValue(value: string | null): boolean {
  return value != null && value.trim() !== "";
}
