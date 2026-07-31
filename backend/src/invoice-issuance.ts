import {
  AmegoTransportError,
  issueAmegoInvoice,
  queryAmegoInvoiceByOrderId,
  sanitizeAmegoResponse,
  type AmegoInvoiceRequest,
  type AmegoInvoiceResult
} from "./amego";
import { MAX_INVOICE_ITEMS, MAX_ITEM_QUANTITY, MAX_MONEY_AMOUNT } from "./constants";
import { sha256Hex } from "./crypto-utils";
import type { PrintJobPayload, UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import {
  normalizeOptionalBoundedString,
  normalizeOptionalCompanyIdentifier,
  normalizeRequiredBoundedString
} from "./request-parsers";
import type { Env, RequestContext } from "./types";
import { readJson, requireArray, requireIntegerRange } from "./validation";

type AuditWriter = (
  env: Env,
  session: UserSession,
  targetType: string,
  targetId: string,
  action: string,
  details?: Record<string, unknown> | null
) => Promise<void>;

type CompanyAmegoSettings = {
  id: number;
  name: string;
  tax_id: string;
  amego_invoice_no: string | null;
  amego_app_key: string | null;
  amego_printer_type: number | null;
  amego_printer_lang: number | null;
};

type NormalizedIssueInput = {
  orderId: string;
  idempotencyKey: string;
  buyerIdentifier: string | null;
  buyerName: string;
  carrierType: string;
  carrierId: string;
  npoban: string;
  deviceId: string | null;
  shouldPrint: boolean;
  totalAmount: number;
  salesAmount: number;
  taxAmount: number;
  checkout: {
    subtotalAmount: number;
    discountType: "amount" | "percentage" | null;
    discountValue: number | null;
    discountAmount: number;
    receivedAmount: number | null;
    changeAmount: number | null;
  };
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
};

type IssuanceRow = {
  id: string;
  status: string;
  order_id: string;
  invoice_id: string | null;
  error_code: string | null;
  request_hash: string;
};

export async function createAmegoInvoice(
  request: Request,
  env: Env,
  session: UserSession,
  context: RequestContext,
  writeAuditLog: AuditWriter
): Promise<Response> {
  if (session.role === "printer") {
    throw new HttpError(403, "forbidden");
  }

  const body = await readJson<Record<string, unknown>>(request);
  const input = normalizeIssueInput(body, request);
  const company = await fetchCompanyAmegoSettings(env, session.company_id);
  if (!company) {
    throw new HttpError(404, "company_not_found");
  }
  const amegoRequest = buildAmegoInvoiceRequest(input, company);
  const requestHash = await sha256Hex(JSON.stringify({
    amegoRequest,
    shouldPrint: input.shouldPrint,
    deviceId: input.deviceId,
    checkout: input.checkout
  }));

  const existing = await findIssuance(env, session.company_id, input.orderId, input.idempotencyKey);
  if (existing) {
    if (existing.order_id !== input.orderId || existing.request_hash !== requestHash) {
      throw new HttpError(409, "invoice_idempotency_conflict");
    }
    return resumeExistingIssuance(env, session, company, existing, writeAuditLog);
  }

  const appKey = company.amego_app_key?.trim();
  if (!appKey) {
    throw new HttpError(409, "amego_app_key_not_configured");
  }
  const invoiceAccount = company.amego_invoice_no?.trim() || company.tax_id.trim();

  const issuanceId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO invoice_issuances (
         id, company_id, order_id, idempotency_key, request_hash, status, request_json
       )
       VALUES (?, ?, ?, ?, ?, 'issuing', ?)`
    )
      .bind(
        issuanceId,
        session.company_id,
        input.orderId,
        input.idempotencyKey,
        requestHash,
        JSON.stringify({
          amegoRequest,
          shouldPrint: input.shouldPrint,
          deviceId: input.deviceId,
          checkout: input.checkout
        })
      )
      .run();
  } catch (error) {
    const raced = await findIssuance(env, session.company_id, input.orderId, input.idempotencyKey);
    if (raced) {
      if (raced.order_id !== input.orderId || raced.request_hash !== requestHash) {
        throw new HttpError(409, "invoice_idempotency_conflict");
      }
      return resumeExistingIssuance(env, session, company, raced, writeAuditLog);
    }
    throw error;
  }

  context.companyId = session.company_id;
  await writeAuditLog(env, session, "invoice_issuance", issuanceId, "invoice.issue.started", {
    orderId: input.orderId,
    totalAmount: input.totalAmount,
    itemCount: input.items.length
  });

  let result: AmegoInvoiceResult;
  try {
    result = await issueAmegoInvoice({
      invoice: invoiceAccount,
      appKey,
      data: amegoRequest,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
  } catch (error) {
    if (!(error instanceof AmegoTransportError)) {
      throw error;
    }
    result = await recoverUnknownResult(env, company, invoiceAccount, appKey, input.orderId, issuanceId, error);
  }

  if (!isAmegoSuccess(result)) {
    await markIssuanceFailed(env, issuanceId, result.code || "amego_rejected", result.raw);
    await writeAuditLog(env, session, "invoice_issuance", issuanceId, "invoice.issue.failed", {
      orderId: input.orderId,
      amegoCode: result.code || "amego_rejected"
    });
    throw new HttpError(422, "amego_invoice_rejected");
  }

  result = await fillMissingOfficialFields(env, company, invoiceAccount, appKey, input.orderId, issuanceId, result);
  const official = requireOfficialInvoiceResult(result);
  const created = await saveIssuedInvoice(env, session, company, issuanceId, input, official);
  await writeAuditLog(env, session, "invoice", created.invoiceId, "invoice.issue.completed", {
    orderId: input.orderId,
    invoiceNumber: official.invoiceNumber,
    printJobId: created.printJobId
  });

  return json({
    issuanceId,
    status: "issued",
    orderId: input.orderId,
    invoiceId: created.invoiceId,
    invoiceNumber: official.invoiceNumber,
    randomNumber: official.randomNumber,
    printJobId: created.printJobId
  }, 201);
}

function normalizeIssueInput(body: Record<string, unknown>, request: Request): NormalizedIssueInput {
  const orderId = normalizeRequiredBoundedString(body.orderId, "orderId", 40);
  if (!/^[A-Za-z0-9._-]+$/.test(orderId)) {
    throw new HttpError(400, "orderId_invalid");
  }
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const bodyKey = normalizeOptionalBoundedString(body.idempotencyKey, 128);
  const idempotencyKey = headerKey || bodyKey || orderId;
  if (idempotencyKey.length > 128) {
    throw new HttpError(400, "idempotency_key_too_long");
  }

  requireIntegerRange(body.totalAmount, "totalAmount", { min: 1, max: MAX_MONEY_AMOUNT });
  requireArray(body.items, "items", { min: 1, max: MAX_INVOICE_ITEMS });
  const items = body.items.map((raw, index) => normalizeInvoiceItem(raw, index));
  const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);
  if (calculatedTotal !== body.totalAmount) {
    throw new HttpError(400, "total_amount_mismatch");
  }

  const totalAmount = body.totalAmount;
  const checkout = normalizeCheckout(body.checkout, totalAmount);
  validateWholeOrderDiscount(items, checkout);

  const buyerIdentifier = normalizeOptionalCompanyIdentifier(body.buyerIdentifier, "buyerIdentifier");
  const buyerName = buyerIdentifier
    ?? normalizeOptionalBoundedString(body.buyerName, 100)
    ?? "消費者";
  const carrierType = normalizeOptionalBoundedString(body.carrierType, 20) ?? "";
  const carrierId = normalizeOptionalBoundedString(body.carrierId, 64) ?? "";
  const npoban = normalizeOptionalBoundedString(body.npoban, 20) ?? "";

  validateInvoiceDestination({ buyerIdentifier, carrierType, carrierId, npoban });

  const salesAmount = buyerIdentifier ? Math.round(totalAmount / 1.05) : totalAmount;
  const taxAmount = buyerIdentifier ? totalAmount - salesAmount : 0;
  const requestedPrint = body.print == null ? true : body.print;
  if (typeof requestedPrint !== "boolean") {
    throw new HttpError(400, "print_invalid");
  }

  return {
    orderId,
    idempotencyKey,
    buyerIdentifier,
    buyerName,
    carrierType,
    carrierId,
    npoban,
    deviceId: normalizeOptionalBoundedString(body.deviceId, 64),
    shouldPrint: buyerIdentifier != null || (!carrierType && !npoban && requestedPrint),
    totalAmount,
    salesAmount,
    taxAmount,
    checkout,
    items
  };
}

function normalizeCheckout(value: unknown, totalAmount: number): NormalizedIssueInput["checkout"] {
  if (value == null) {
    return {
      subtotalAmount: totalAmount,
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      receivedAmount: null,
      changeAmount: null
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "checkout_invalid");
  const checkout = value as Record<string, unknown>;
  requireIntegerRange(checkout.subtotalAmount, "checkout.subtotalAmount", { min: totalAmount, max: MAX_MONEY_AMOUNT });
  requireIntegerRange(checkout.discountAmount, "checkout.discountAmount", { min: 0, max: MAX_MONEY_AMOUNT });
  requireIntegerRange(checkout.receivedAmount, "checkout.receivedAmount", { min: totalAmount, max: MAX_MONEY_AMOUNT });
  requireIntegerRange(checkout.changeAmount, "checkout.changeAmount", { min: 0, max: MAX_MONEY_AMOUNT });
  if (checkout.discountAmount !== checkout.subtotalAmount - totalAmount) throw new HttpError(400, "checkout_amount_mismatch");
  if (checkout.changeAmount !== checkout.receivedAmount - totalAmount) throw new HttpError(400, "checkout_amount_mismatch");

  const discountType = checkout.discountType == null ? null : checkout.discountType;
  const discountValue = checkout.discountValue == null ? null : checkout.discountValue;
  if (discountType == null) {
    if (discountValue != null || checkout.discountAmount !== 0) throw new HttpError(400, "checkout_discount_invalid");
  } else {
    if (discountType !== "amount" && discountType !== "percentage") throw new HttpError(400, "checkout_discount_invalid");
    requireIntegerRange(discountValue, "checkout.discountValue", { min: discountType === "percentage" ? 1 : 0, max: discountType === "percentage" ? 100 : checkout.subtotalAmount });
    const expectedDiscount = discountType === "amount"
      ? discountValue
      : checkout.subtotalAmount - Math.floor((checkout.subtotalAmount * discountValue + 50) / 100);
    if (checkout.discountAmount !== expectedDiscount) throw new HttpError(400, "checkout_discount_invalid");
  }
  return {
    subtotalAmount: checkout.subtotalAmount,
    discountType,
    discountValue,
    discountAmount: checkout.discountAmount,
    receivedAmount: checkout.receivedAmount,
    changeAmount: checkout.changeAmount
  };
}

function normalizeInvoiceItem(value: unknown, index: number): NormalizedIssueInput["items"][number] {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new HttpError(400, `items.${index}_invalid`);
  }
  const item = value as Record<string, unknown>;
  const name = normalizeRequiredBoundedString(item.name, `items.${index}.name`, 100);
  requireIntegerRange(item.quantity, `items.${index}.quantity`, { min: 1, max: MAX_ITEM_QUANTITY });
  requireIntegerRange(item.unitPrice, `items.${index}.unitPrice`, { min: name === "整單折扣" ? -MAX_MONEY_AMOUNT : 0, max: MAX_MONEY_AMOUNT });
  if (name === "整單折扣" && (item.quantity !== 1 || item.unitPrice >= 0)) {
    throw new HttpError(400, "checkout_discount_invalid");
  }
  const amount = item.quantity * item.unitPrice;
  requireIntegerRange(amount, `items.${index}.amount`, { min: -MAX_MONEY_AMOUNT, max: MAX_MONEY_AMOUNT });
  return {
    id: crypto.randomUUID(),
    name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount
  };
}

function validateWholeOrderDiscount(
  items: NormalizedIssueInput["items"],
  checkout: NormalizedIssueInput["checkout"]
): void {
  const discountItems = items.filter((item) => item.name === "整單折扣");
  if (checkout.discountAmount === 0) {
    if (discountItems.length > 0) throw new HttpError(400, "checkout_discount_invalid");
    return;
  }
  if (discountItems.length !== 1 || discountItems[0].amount !== -checkout.discountAmount) {
    throw new HttpError(400, "checkout_discount_invalid");
  }
}

function validateInvoiceDestination(input: {
  buyerIdentifier: string | null;
  carrierType: string;
  carrierId: string;
  npoban: string;
}): void {
  if (input.carrierType && !input.carrierId) {
    throw new HttpError(400, "carrierId_required");
  }
  if (!input.carrierType && input.carrierId) {
    throw new HttpError(400, "carrierType_required");
  }
  if (input.carrierType && !["3J0002", "CQ0001", "amego"].includes(input.carrierType)) {
    throw new HttpError(400, "carrierType_invalid");
  }
  if (input.carrierType === "3J0002" && !/^\/[0-9A-Z.+-]{7}$/.test(input.carrierId)) {
    throw new HttpError(400, "carrierId_invalid");
  }
  if (input.npoban && !/^\d{3,7}$/.test(input.npoban)) {
    throw new HttpError(400, "npoban_invalid");
  }
  if (input.buyerIdentifier && (input.carrierType || input.npoban)) {
    throw new HttpError(400, "invoice_destination_conflict");
  }
  if (input.carrierType && input.npoban) {
    throw new HttpError(400, "invoice_destination_conflict");
  }
}

function buildAmegoInvoiceRequest(
  input: NormalizedIssueInput,
  company: CompanyAmegoSettings
): AmegoInvoiceRequest {
  const request: AmegoInvoiceRequest = {
    OrderId: input.orderId,
    BuyerIdentifier: input.buyerIdentifier ?? "0000000000",
    BuyerName: input.buyerName,
    BuyerAddress: "",
    BuyerTelephoneNumber: "",
    BuyerEmailAddress: "",
    MainRemark: "",
    CarrierType: input.carrierType,
    CarrierId1: input.carrierId,
    CarrierId2: input.carrierId,
    NPOBAN: input.npoban,
    ProductItem: input.items.map((item) => ({
      Description: item.name,
      Quantity: item.quantity,
      UnitPrice: item.unitPrice,
      Amount: item.amount,
      Remark: "",
      TaxType: "1"
    })),
    SalesAmount: String(input.salesAmount),
    FreeTaxSalesAmount: "0",
    ZeroTaxSalesAmount: "0",
    TaxType: "1",
    TaxRate: "0.05",
    TaxAmount: String(input.taxAmount),
    TotalAmount: String(input.totalAmount)
  };
  if (company.amego_printer_type != null) {
    request.PrinterType = company.amego_printer_type;
    request.PrinterLang = company.amego_printer_lang ?? 2;
  }
  return request;
}

async function fetchCompanyAmegoSettings(env: Env, companyId: number): Promise<CompanyAmegoSettings | null> {
  return env.DB.prepare(
    `SELECT id, name, tax_id, amego_invoice_no, amego_app_key,
            amego_printer_type, amego_printer_lang
     FROM companies
     WHERE id = ?`
  )
    .bind(companyId)
    .first<CompanyAmegoSettings>();
}

async function findIssuance(
  env: Env,
  companyId: number,
  orderId: string,
  idempotencyKey: string
): Promise<IssuanceRow | null> {
  return env.DB.prepare(
    `SELECT id, status, order_id, invoice_id, error_code, request_hash
     FROM invoice_issuances
     WHERE company_id = ?
       AND (order_id = ? OR idempotency_key = ?)
     ORDER BY created_at ASC
     LIMIT 1`
  )
    .bind(companyId, orderId, idempotencyKey)
    .first<IssuanceRow>();
}

async function resumeExistingIssuance(
  env: Env,
  session: UserSession,
  company: CompanyAmegoSettings,
  issuance: IssuanceRow,
  writeAuditLog: AuditWriter
): Promise<Response> {
  if (issuance.status === "issued" && issuance.invoice_id) {
    return json(await issuedInvoiceResponse(env, issuance.id, issuance.order_id, issuance.invoice_id));
  }
  if (issuance.status === "failed") {
    throw new HttpError(409, "invoice_issuance_failed");
  }

  const appKey = company.amego_app_key?.trim();
  if (!appKey) {
    throw new HttpError(409, "amego_app_key_not_configured");
  }
  const invoiceAccount = company.amego_invoice_no?.trim() || company.tax_id.trim();
  let result: AmegoInvoiceResult;
  try {
    result = await queryAmegoInvoiceByOrderId({
      invoice: invoiceAccount,
      appKey,
      orderId: issuance.order_id,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
  } catch {
    throw new HttpError(502, "amego_result_unknown");
  }
  if (!isAmegoSuccess(result)) {
    throw new HttpError(502, "amego_result_unknown");
  }

  const requestRow = await env.DB.prepare(
    `SELECT request_json FROM invoice_issuances WHERE id = ?`
  ).bind(issuance.id).first<{ request_json: string }>();
  if (!requestRow) {
    throw new HttpError(404, "invoice_issuance_not_found");
  }
  const restored = restoreNormalizedInput(requestRow.request_json, issuance.order_id);
  const official = requireOfficialInvoiceResult(result);
  const created = await saveIssuedInvoice(env, session, company, issuance.id, restored, official);
  await writeAuditLog(env, session, "invoice", created.invoiceId, "invoice.issue.recovered", {
    orderId: issuance.order_id,
    invoiceNumber: official.invoiceNumber
  });
  return json(await issuedInvoiceResponse(env, issuance.id, issuance.order_id, created.invoiceId));
}

async function recoverUnknownResult(
  env: Env,
  company: CompanyAmegoSettings,
  invoiceAccount: string,
  appKey: string,
  orderId: string,
  issuanceId: string,
  transportError: AmegoTransportError
): Promise<AmegoInvoiceResult> {
  try {
    const queried = await queryAmegoInvoiceByOrderId({
      invoice: invoiceAccount,
      appKey,
      orderId,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
    if (isAmegoSuccess(queried)) {
      return queried;
    }
  } catch {
    // Keep issuing so a later retry can query the same OrderId safely.
  }
  await env.DB.prepare(
    `UPDATE invoice_issuances
     SET error_code = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'issuing'`
  ).bind(transportError.code, issuanceId).run();
  throw new HttpError(502, "amego_result_unknown");
}

async function fillMissingOfficialFields(
  env: Env,
  company: CompanyAmegoSettings,
  invoiceAccount: string,
  appKey: string,
  orderId: string,
  issuanceId: string,
  result: AmegoInvoiceResult
): Promise<AmegoInvoiceResult> {
  if (hasOfficialInvoiceFields(result)) {
    return result;
  }
  try {
    const queried = await queryAmegoInvoiceByOrderId({
      invoice: invoiceAccount,
      appKey,
      orderId,
      apiBaseUrl: env.AMEGO_API_BASE_URL
    });
    if (isAmegoSuccess(queried) && hasOfficialInvoiceFields(queried)) {
      return queried;
    }
  } catch {
    // The invoice may exist even though the follow-up query failed.
  }
  await env.DB.prepare(
    `UPDATE invoice_issuances
     SET response_json = ?, error_code = 'amego_payload_incomplete', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'issuing'`
  ).bind(JSON.stringify(sanitizeAmegoResponse(result.raw)), issuanceId).run();
  throw new HttpError(502, "amego_payload_incomplete");
}

function isAmegoSuccess(result: AmegoInvoiceResult): boolean {
  return result.code === "0";
}

function hasOfficialInvoiceFields(result: AmegoInvoiceResult): boolean {
  return Boolean(
    result.invoiceNumber
    && /^[A-Z]{2}\d{8}$/.test(result.invoiceNumber)
    && result.randomNumber
    && /^\d{4}$/.test(result.randomNumber)
    && result.barcode
    && result.qrcodeLeft
    && result.qrcodeRight
  );
}

function requireOfficialInvoiceResult(result: AmegoInvoiceResult) {
  if (!hasOfficialInvoiceFields(result)) {
    throw new HttpError(502, "amego_payload_incomplete");
  }
  return {
    invoiceNumber: result.invoiceNumber as string,
    invoiceDate: result.invoiceDate,
    invoiceTime: result.invoiceTime,
    randomNumber: result.randomNumber as string,
    barcode: result.barcode as string,
    qrcodeLeft: result.qrcodeLeft as string,
    qrcodeRight: result.qrcodeRight as string,
    responseJson: JSON.stringify(sanitizeAmegoResponse(result.raw))
  };
}

async function saveIssuedInvoice(
  env: Env,
  session: UserSession,
  company: CompanyAmegoSettings,
  issuanceId: string,
  input: NormalizedIssueInput,
  official: ReturnType<typeof requireOfficialInvoiceResult>
): Promise<{ invoiceId: string; printJobId: string | null }> {
  const invoiceId = crypto.randomUUID();
  const printJobId = input.shouldPrint ? crypto.randomUUID() : null;
  const issuedAt = normalizeAmegoIssuedAt(official.invoiceDate, official.invoiceTime);
  const deviceId = await resolveDeviceId(env, session.company_id, input.deviceId ?? session.device_id);
  const payload: PrintJobPayload = {
    remoteId: printJobId ?? "",
    invoiceNumber: official.invoiceNumber,
    randomNumber: official.randomNumber,
    issuedAt,
    sellerName: company.name,
    sellerIdentifier: company.tax_id,
    buyerIdentifier: input.buyerIdentifier ?? undefined,
    totalAmount: input.totalAmount,
    salesAmount: input.salesAmount,
    taxAmount: input.taxAmount,
    subtotalAmount: input.checkout.subtotalAmount,
    discountType: input.checkout.discountType ?? undefined,
    discountValue: input.checkout.discountValue ?? undefined,
    discountAmount: input.checkout.discountAmount,
    receivedAmount: input.checkout.receivedAmount ?? undefined,
    changeAmount: input.checkout.changeAmount ?? undefined,
    invoiceFormatCode: input.buyerIdentifier ? "25" : undefined,
    items: input.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })),
    leftQRCodePayload: official.qrcodeLeft,
    rightQRCodePayload: official.qrcodeRight,
    barcodePayload: official.barcode
  };

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO invoices (
         id, company_id, invoice_number, random_number, issued_at,
         seller_name, seller_identifier, buyer_identifier, total_amount,
         amego_response_json, amego_order_id, status, invoice_date, invoice_time,
         sales_amount, tax_amount, barcode_payload, qrcode_left, qrcode_right,
         carrier_type, carrier_id, npoban, subtotal_amount, discount_type, discount_value,
         discount_amount, received_amount, change_amount
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      invoiceId,
      session.company_id,
      official.invoiceNumber,
      official.randomNumber,
      issuedAt,
      company.name,
      company.tax_id,
      input.buyerIdentifier,
      input.totalAmount,
      official.responseJson,
      input.orderId,
      official.invoiceDate,
      official.invoiceTime == null ? null : String(official.invoiceTime),
      input.salesAmount,
      input.taxAmount,
      official.barcode,
      official.qrcodeLeft,
      official.qrcodeRight,
      input.carrierType || null,
      input.carrierId || null,
      input.npoban || null,
      input.checkout.subtotalAmount,
      input.checkout.discountType,
      input.checkout.discountValue,
      input.checkout.discountAmount,
      input.checkout.receivedAmount,
      input.checkout.changeAmount
    ),
    ...input.items.map((item) => env.DB.prepare(
      `INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price, amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(item.id, invoiceId, item.name, item.quantity, item.unitPrice, item.amount)),
    ...(printJobId ? [env.DB.prepare(
      `INSERT INTO print_jobs (id, company_id, device_id, invoice_id, status, payload_json, idempotency_key)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      printJobId,
      session.company_id,
      deviceId,
      invoiceId,
      JSON.stringify(payload),
      `${session.company_id}:amego:${input.orderId}`
    )] : []),
    env.DB.prepare(
      `UPDATE invoice_issuances
       SET status = 'issued', response_json = ?, invoice_id = ?, error_code = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'issuing'`
    ).bind(official.responseJson, invoiceId, issuanceId)
  ];

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const existing = await env.DB.prepare(
      `SELECT id FROM invoices WHERE company_id = ? AND amego_order_id = ?`
    ).bind(session.company_id, input.orderId).first<{ id: string }>();
    if (existing) {
      const response = await issuedInvoiceResponse(env, issuanceId, input.orderId, existing.id);
      return { invoiceId: existing.id, printJobId: response.printJobId };
    }
    throw error;
  }

  return { invoiceId, printJobId };
}

async function resolveDeviceId(env: Env, companyId: number, deviceId: string | null): Promise<string | null> {
  if (!deviceId) {
    return null;
  }
  const row = await env.DB.prepare(
    `SELECT id FROM devices WHERE id = ? AND company_id = ?`
  ).bind(deviceId, companyId).first<{ id: string }>();
  if (!row) {
    throw new HttpError(400, "invalid_device_id");
  }
  return row.id;
}

async function issuedInvoiceResponse(env: Env, issuanceId: string, orderId: string, invoiceId: string) {
  const row = await env.DB.prepare(
    `SELECT i.invoice_number, i.random_number,
            (SELECT id FROM print_jobs WHERE invoice_id = i.id ORDER BY created_at ASC LIMIT 1) AS print_job_id
     FROM invoices i
     WHERE i.id = ?`
  ).bind(invoiceId).first<{
    invoice_number: string;
    random_number: string;
    print_job_id: string | null;
  }>();
  if (!row) {
    throw new HttpError(404, "invoice_not_found");
  }
  return {
    issuanceId,
    status: "issued",
    orderId,
    invoiceId,
    invoiceNumber: row.invoice_number,
    randomNumber: row.random_number,
    printJobId: row.print_job_id
  };
}

async function markIssuanceFailed(
  env: Env,
  issuanceId: string,
  errorCode: string,
  raw: Record<string, unknown>
): Promise<void> {
  await env.DB.prepare(
    `UPDATE invoice_issuances
     SET status = 'failed', response_json = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'issuing'`
  ).bind(JSON.stringify(sanitizeAmegoResponse(raw)), errorCode.slice(0, 100), issuanceId).run();
}

function normalizeAmegoIssuedAt(invoiceDate: string | null, invoiceTime: string | number | null): string {
  if (typeof invoiceTime === "number" || (typeof invoiceTime === "string" && /^\d{10,13}$/.test(invoiceTime))) {
    const numeric = Number(invoiceTime);
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (invoiceDate && /^\d{8}$/.test(invoiceDate) && typeof invoiceTime === "string" && /^\d{2}:\d{2}:\d{2}$/.test(invoiceTime)) {
    const date = `${invoiceDate.slice(0, 4)}-${invoiceDate.slice(4, 6)}-${invoiceDate.slice(6, 8)}`;
    const parsed = new Date(`${date}T${invoiceTime}+08:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function restoreNormalizedInput(requestJson: string, orderId: string): NormalizedIssueInput {
  const stored = JSON.parse(requestJson) as {
    amegoRequest?: AmegoInvoiceRequest;
    shouldPrint?: boolean;
    deviceId?: string | null;
    checkout?: NormalizedIssueInput["checkout"];
  } & Partial<AmegoInvoiceRequest>;
  const request = stored.amegoRequest ?? stored as AmegoInvoiceRequest;
  const buyerIdentifier = request.BuyerIdentifier === "0000000000" ? null : request.BuyerIdentifier;
  const items = request.ProductItem.map((item) => ({
    id: crypto.randomUUID(),
    name: item.Description,
    quantity: Number(item.Quantity),
    unitPrice: Number(item.UnitPrice),
    amount: Number(item.Amount)
  }));
  return {
    orderId,
    idempotencyKey: orderId,
    buyerIdentifier,
    buyerName: request.BuyerName,
    carrierType: request.CarrierType,
    carrierId: request.CarrierId1,
    npoban: request.NPOBAN,
    deviceId: stored.deviceId ?? null,
    shouldPrint: stored.shouldPrint ?? (buyerIdentifier != null || (!request.CarrierType && !request.NPOBAN)),
    totalAmount: Number(request.TotalAmount),
    salesAmount: Number(request.SalesAmount),
    taxAmount: Number(request.TaxAmount),
    checkout: stored.checkout ?? {
      subtotalAmount: Number(request.TotalAmount),
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      receivedAmount: null,
      changeAmount: null
    },
    items
  };
}
