import {
  AmegoTransportError,
  queryAmegoInvoiceByNumber,
  queryAmegoInvoiceStatus,
  sanitizeAmegoResponse,
  voidAmegoInvoice,
  type AmegoInvoiceResult
} from "./amego";
import {
  amegoInvoiceStatusAuditDetails,
  requireAmegoInvoiceIssued
} from "./amego-invoice-state";
import { requireOwnerAccess } from "./auth";
import type { PrintJobPayload, UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import type { Env } from "./types";

type AuditWriter = (
  env: Env,
  session: UserSession,
  targetType: string,
  targetId: string,
  action: string,
  details?: Record<string, unknown> | null
) => Promise<void>;

type InvoiceRow = {
  id: string;
  amego_order_id: string | null;
  invoice_number: string;
  random_number: string;
  issued_at: string;
  seller_name: string | null;
  seller_identifier: string;
  buyer_identifier: string | null;
  total_amount: number;
  subtotal_amount: number | null;
  discount_type: "amount" | "percentage" | null;
  discount_value: number | null;
  discount_amount: number | null;
  received_amount: number | null;
  change_amount: number | null;
  sales_amount: number;
  tax_amount: number;
  status: string;
  invoice_date: string | null;
  invoice_time: string | null;
  barcode_payload: string | null;
  qrcode_left: string | null;
  qrcode_right: string | null;
  carrier_type: string | null;
  carrier_id: string | null;
  npoban: string | null;
  voided_at: string | null;
  print_status: string | null;
};

type ItemRow = {
  id: string;
  invoice_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

type CompanySettings = {
  name: string;
  tax_id: string;
  amego_invoice_no: string | null;
  amego_app_key: string | null;
};

export async function listInvoices(env: Env, session: UserSession, url: URL): Promise<Response> {
  const date = url.searchParams.get("date")?.trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, "date_invalid");
  }
  const start = date ? `${date}T00:00:00.000Z` : null;
  const end = date ? `${date}T23:59:59.999Z` : null;
  const rows = await env.DB.prepare(
    `WITH latest_jobs AS (
       SELECT invoice_id, status,
              ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY created_at DESC, id DESC) AS rn
       FROM print_jobs
       WHERE company_id = ?
     )
     SELECT i.*, latest_jobs.status AS print_status
     FROM invoices i
     LEFT JOIN latest_jobs ON latest_jobs.invoice_id = i.id AND latest_jobs.rn = 1
     WHERE i.company_id = ?
       AND (? IS NULL OR (i.issued_at >= ? AND i.issued_at <= ?))
     ORDER BY i.issued_at DESC, i.id DESC
     LIMIT 200`
  ).bind(session.company_id, session.company_id, start, start, end).all<InvoiceRow>();

  const items = await loadItems(env, rows.results.map((row) => row.id));
  const issuing = await env.DB.prepare(
    `SELECT id, order_id, created_at
     FROM invoice_issuances
     WHERE company_id = ? AND status = 'issuing' AND invoice_id IS NULL
       AND (? IS NULL OR (created_at >= ? AND created_at <= ?))
     ORDER BY created_at DESC
     LIMIT 200`
  ).bind(session.company_id, date ? `${date} 00:00:00` : null, date ? `${date} 00:00:00` : null, date ? `${date} 23:59:59` : null)
    .all<{ id: string; order_id: string; created_at: string }>();

  return json({
    invoices: [
      ...issuing.results.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        invoiceNumber: null,
        status: "issuing",
        issuedAt: row.created_at,
        totalAmount: 0,
        items: []
      })),
      ...rows.results.map((row) => invoiceJson(row, items.get(row.id) ?? []))
    ]
  });
}

export async function getInvoice(env: Env, session: UserSession, id: string): Promise<Response> {
  const row = await fetchInvoice(env, session.company_id, id);
  if (!row) throw new HttpError(404, "invoice_not_found");
  const items = await loadItems(env, [row.id]);
  return json({ invoice: invoiceJson(row, items.get(row.id) ?? []) });
}

export async function refreshInvoice(
  env: Env,
  session: UserSession,
  id: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireInvoiceManager(session);
  const row = await fetchInvoice(env, session.company_id, id);
  if (!row) throw new HttpError(404, "invoice_not_found");
  const { invoiceAccount, appKey } = await amegoSettings(env, session.company_id);
  const result = await queryAmegoInvoiceByNumber({
    invoice: invoiceAccount,
    appKey,
    invoiceNumber: row.invoice_number,
    apiBaseUrl: env.AMEGO_API_BASE_URL
  });
  requireSuccessfulQuery(result, row.invoice_number);

  await env.DB.prepare(
    `UPDATE invoices
     SET random_number = COALESCE(NULLIF(?, ''), random_number),
         invoice_date = COALESCE(NULLIF(?, ''), invoice_date),
         invoice_time = COALESCE(NULLIF(?, ''), invoice_time),
         barcode_payload = COALESCE(NULLIF(?, ''), barcode_payload),
         qrcode_left = COALESCE(NULLIF(?, ''), qrcode_left),
         qrcode_right = COALESCE(NULLIF(?, ''), qrcode_right),
         amego_response_json = ?, amego_error_code = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  ).bind(
    result.randomNumber,
    result.invoiceDate,
    result.invoiceTime == null ? null : String(result.invoiceTime),
    result.barcode,
    result.qrcodeLeft,
    result.qrcodeRight,
    JSON.stringify(sanitizeAmegoResponse(result.raw)),
    id,
    session.company_id
  ).run();
  await writeAuditLog(env, session, "invoice", id, "invoice.query.completed", {
    invoiceNumber: row.invoice_number
  });
  return getInvoice(env, session, id);
}

export async function reprintInvoice(
  env: Env,
  session: UserSession,
  id: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireInvoiceManager(session);
  let row = await fetchInvoice(env, session.company_id, id);
  if (!row) throw new HttpError(404, "invoice_not_found");
  if (row.status === "voided") throw new HttpError(409, "invoice_voided");
  const settings = await amegoSettings(env, session.company_id);
  await verifyAmegoInvoiceIssued(env, session, row, settings, "reprint", writeAuditLog);
  if (!row.barcode_payload || !row.qrcode_left || !row.qrcode_right) {
    row = await repairInvoicePrintPayload(env, session, row, settings, writeAuditLog);
  }
  if (!row.barcode_payload || !row.qrcode_left || !row.qrcode_right) {
    throw new HttpError(409, "invoice_payload_incomplete");
  }
  const items = (await loadItems(env, [id])).get(id) ?? [];
  const deviceId = await resolveDeviceId(env, session.company_id, session.device_id);
  if (!deviceId) throw new HttpError(409, "company_device_not_found");
  const printJobId = crypto.randomUUID();
  const payload: PrintJobPayload = {
    remoteId: printJobId,
    invoiceNumber: row.invoice_number,
    randomNumber: row.random_number,
    issuedAt: row.issued_at,
    sellerName: row.seller_name ?? undefined,
    sellerIdentifier: row.seller_identifier,
    buyerIdentifier: row.buyer_identifier ?? undefined,
    totalAmount: row.total_amount,
    salesAmount: row.sales_amount,
    taxAmount: row.tax_amount,
    subtotalAmount: row.subtotal_amount ?? undefined,
    discountType: row.discount_type ?? undefined,
    discountValue: row.discount_value ?? undefined,
    discountAmount: row.discount_amount ?? undefined,
    receivedAmount: row.received_amount ?? undefined,
    changeAmount: row.change_amount ?? undefined,
    invoiceFormatCode: row.buyer_identifier ? "25" : undefined,
    isReprint: true,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price
    })),
    leftQRCodePayload: row.qrcode_left,
    rightQRCodePayload: row.qrcode_right,
    barcodePayload: row.barcode_payload
  };
  await env.DB.prepare(
    `INSERT INTO print_jobs (id, company_id, device_id, invoice_id, status, payload_json, idempotency_key)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(printJobId, session.company_id, deviceId, id, JSON.stringify(payload), `reprint:${printJobId}`).run();
  await writeAuditLog(env, session, "invoice", id, "invoice.reprint.created", {
    invoiceNumber: row.invoice_number,
    printJobId,
    deviceId
  });
  return json({ ok: true, printJobId }, 201);
}

export async function voidInvoice(
  env: Env,
  session: UserSession,
  id: string,
  writeAuditLog: AuditWriter
): Promise<Response> {
  requireOwnerAccess(session);
  const row = await fetchInvoice(env, session.company_id, id);
  if (!row) throw new HttpError(404, "invoice_not_found");
  if (row.status === "voided") return json({ ok: true, idempotent: true });
  const settings = await amegoSettings(env, session.company_id);
  await verifyAmegoInvoiceIssued(env, session, row, settings, "void", writeAuditLog);
  const result = await voidAmegoInvoice({
    invoice: settings.invoiceAccount,
    appKey: settings.appKey,
    invoiceNumber: row.invoice_number,
    apiBaseUrl: env.AMEGO_API_BASE_URL
  });
  if (result.code !== "0") throw new HttpError(422, "amego_invoice_void_rejected");
  const responseJson = JSON.stringify(sanitizeAmegoResponse(result.raw));
  const pendingJobs = await env.DB.prepare(
    `SELECT id FROM print_jobs WHERE company_id = ? AND invoice_id = ? AND status = 'pending'`
  ).bind(session.company_id, id).all<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE invoices
       SET status = 'voided', voided_at = CURRENT_TIMESTAMP,
           amego_void_response_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND company_id = ? AND status = 'issued'`
    ).bind(responseJson, id, session.company_id),
    env.DB.prepare(
      `UPDATE print_jobs
       SET status = 'failed', last_error = 'invoice_voided', updated_at = CURRENT_TIMESTAMP
       WHERE company_id = ? AND invoice_id = ? AND status = 'pending'`
    ).bind(session.company_id, id)
  ]);
  await writeAuditLog(env, session, "invoice", id, "invoice.void.completed", {
    invoiceNumber: row.invoice_number,
    stoppedPrintJobIds: pendingJobs.results.map((job) => job.id)
  });
  return json({ ok: true });
}

function invoiceJson(row: InvoiceRow, items: ItemRow[]) {
  return {
    id: row.id,
    orderId: row.amego_order_id,
    invoiceNumber: row.invoice_number,
    status: effectiveStatus(row),
    issuedAt: row.issued_at,
    invoiceDate: row.invoice_date,
    invoiceTime: row.invoice_time,
    randomNumber: row.random_number,
    sellerName: row.seller_name,
    sellerIdentifier: row.seller_identifier,
    buyerIdentifier: row.buyer_identifier,
    carrierType: row.carrier_type,
    carrierId: row.carrier_id,
    npoban: row.npoban,
    totalAmount: row.total_amount,
    subtotalAmount: row.subtotal_amount,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountAmount: row.discount_amount,
    receivedAmount: row.received_amount,
    changeAmount: row.change_amount,
    voidedAt: row.voided_at,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      amount: item.amount
    }))
  };
}

function effectiveStatus(row: InvoiceRow): string {
  if (row.status === "voided") return "voided";
  if (row.print_status === "pending" || row.print_status === "printing") return "print_pending";
  if (row.print_status === "printed") return "printed";
  if (row.print_status === "failed") return "print_failed";
  return "issued";
}

async function fetchInvoice(env: Env, companyId: number, id: string): Promise<InvoiceRow | null> {
  return env.DB.prepare(
    `WITH latest_job AS (
       SELECT status FROM print_jobs
       WHERE company_id = ? AND invoice_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1
     )
     SELECT i.*, (SELECT status FROM latest_job) AS print_status
     FROM invoices i WHERE i.id = ? AND i.company_id = ?`
  ).bind(companyId, id, id, companyId).first<InvoiceRow>();
}

async function loadItems(env: Env, invoiceIds: string[]): Promise<Map<string, ItemRow[]>> {
  const result = new Map<string, ItemRow[]>();
  if (invoiceIds.length === 0) return result;
  const placeholders = invoiceIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, invoice_id, name, quantity, unit_price, amount
     FROM invoice_items WHERE invoice_id IN (${placeholders}) ORDER BY rowid ASC`
  ).bind(...invoiceIds).all<ItemRow>();
  for (const row of rows.results) result.set(row.invoice_id, [...(result.get(row.invoice_id) ?? []), row]);
  return result;
}

async function amegoSettings(env: Env, companyId: number) {
  const company = await env.DB.prepare(
    `SELECT name, tax_id, amego_invoice_no, amego_app_key FROM companies WHERE id = ?`
  ).bind(companyId).first<CompanySettings>();
  if (!company) throw new HttpError(404, "company_not_found");
  const appKey = company.amego_app_key?.trim();
  if (!appKey) throw new HttpError(409, "amego_app_key_not_configured");
  return { company, appKey, invoiceAccount: company.amego_invoice_no?.trim() || company.tax_id.trim() };
}

function requireSuccessfulQuery(result: AmegoInvoiceResult, invoiceNumber: string): void {
  if (result.code !== "0") throw new HttpError(422, "amego_invoice_query_failed");
  if (result.invoiceNumber && result.invoiceNumber !== invoiceNumber) {
    throw new HttpError(409, "amego_invoice_number_mismatch");
  }
}

async function verifyAmegoInvoiceIssued(
  env: Env,
  session: UserSession,
  row: InvoiceRow,
  settings: Awaited<ReturnType<typeof amegoSettings>>,
  operation: "void" | "reprint",
  writeAuditLog: AuditWriter
): Promise<void> {
  let result;
  try {
    result = await queryAmegoInvoiceStatus({
      invoice: settings.invoiceAccount,
      appKey: settings.appKey,
      invoiceNumber: row.invoice_number,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
  } catch (error) {
    if (!(error instanceof AmegoTransportError)) throw error;
    await writeAuditLog(env, session, "invoice", row.id, "invoice.status.check_failed", {
      operation,
      invoiceNumber: row.invoice_number,
      transportError: error.code,
      upstreamStatus: error.status
    });
    throw new HttpError(502, "amego_invoice_status_unavailable");
  }

  await writeAuditLog(
    env,
    session,
    "invoice",
    row.id,
    "invoice.status.checked",
    amegoInvoiceStatusAuditDetails(result, operation)
  );
  requireAmegoInvoiceIssued(result, row.invoice_number);
}

async function repairInvoicePrintPayload(
  env: Env,
  session: UserSession,
  row: InvoiceRow,
  settings: Awaited<ReturnType<typeof amegoSettings>>,
  writeAuditLog: AuditWriter
): Promise<InvoiceRow> {
  const result = await queryAmegoInvoiceByNumber({
    invoice: settings.invoiceAccount,
    appKey: settings.appKey,
    invoiceNumber: row.invoice_number,
    apiBaseUrl: env.AMEGO_API_BASE_URL
  });
  requireSuccessfulQuery(result, row.invoice_number);
  await env.DB.prepare(
    `UPDATE invoices
     SET random_number = COALESCE(NULLIF(?, ''), random_number),
         invoice_date = COALESCE(NULLIF(?, ''), invoice_date),
         invoice_time = COALESCE(NULLIF(?, ''), invoice_time),
         barcode_payload = COALESCE(NULLIF(?, ''), barcode_payload),
         qrcode_left = COALESCE(NULLIF(?, ''), qrcode_left),
         qrcode_right = COALESCE(NULLIF(?, ''), qrcode_right),
         amego_response_json = ?, amego_error_code = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  ).bind(
    result.randomNumber,
    result.invoiceDate,
    result.invoiceTime == null ? null : String(result.invoiceTime),
    result.barcode,
    result.qrcodeLeft,
    result.qrcodeRight,
    JSON.stringify(sanitizeAmegoResponse(result.raw)),
    row.id,
    session.company_id
  ).run();
  await writeAuditLog(env, session, "invoice", row.id, "invoice.query.completed", {
    invoiceNumber: row.invoice_number,
    reason: "reprint_payload_repair"
  });
  const repaired = await fetchInvoice(env, session.company_id, row.id);
  if (!repaired) throw new HttpError(404, "invoice_not_found");
  return repaired;
}

async function resolveDeviceId(env: Env, companyId: number, preferred: string | null): Promise<string | null> {
  if (preferred) {
    const found = await env.DB.prepare(
      `SELECT id FROM devices WHERE id = ? AND company_id = ?`
    ).bind(preferred, companyId).first<{ id: string }>();
    if (found) return found.id;
  }
  const primary = await env.DB.prepare(
    `SELECT id FROM devices WHERE company_id = ? ORDER BY created_at ASC LIMIT 1`
  ).bind(companyId).first<{ id: string }>();
  return primary?.id ?? null;
}

function requireInvoiceManager(session: UserSession): void {
  if (session.role === "printer") throw new HttpError(403, "forbidden");
}
