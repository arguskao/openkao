import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const DEFAULT_AMEGO_API_BASE_URL = "https://invoice-api.amego.tw/json";
const DEFAULT_TIMEOUT_MS = 12_000;

export type AmegoProductItem = {
  Description: string;
  Quantity: number;
  UnitPrice: number;
  Amount: number;
  Remark: string;
  TaxType: "1";
};

export type AmegoInvoiceRequest = {
  OrderId: string;
  BuyerIdentifier: string;
  BuyerName: string;
  BuyerAddress: string;
  BuyerTelephoneNumber: string;
  BuyerEmailAddress: string;
  MainRemark: string;
  CarrierType: string;
  CarrierId1: string;
  CarrierId2: string;
  NPOBAN: string;
  ProductItem: AmegoProductItem[];
  SalesAmount: string;
  FreeTaxSalesAmount: "0";
  ZeroTaxSalesAmount: "0";
  TaxType: "1";
  TaxRate: "0.05";
  TaxAmount: string;
  TotalAmount: string;
  PrinterType?: number;
  PrinterLang?: number;
};

export type AmegoInvoiceResult = {
  code: string;
  message: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTime: string | number | null;
  randomNumber: string | null;
  barcode: string | null;
  qrcodeLeft: string | null;
  qrcodeRight: string | null;
  raw: Record<string, unknown>;
};

export class AmegoTransportError extends Error {
  constructor(
    readonly code: "amego_timeout" | "amego_http_error" | "amego_invalid_response",
    readonly status: number | null = null
  ) {
    super(code);
  }
}

export function createAmegoSignature(data: string, timestamp: string, appKey: string): string {
  return bytesToHex(md5(new TextEncoder().encode(`${data}${timestamp}${appKey}`)));
}

export async function issueAmegoInvoice(input: {
  invoice: string;
  appKey: string;
  data: AmegoInvoiceRequest;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<AmegoInvoiceResult> {
  return postAmego({
    endpoint: "f0401",
    invoice: input.invoice,
    appKey: input.appKey,
    data: input.data,
    apiBaseUrl: input.apiBaseUrl,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher
  });
}

export async function queryAmegoInvoiceByOrderId(input: {
  invoice: string;
  appKey: string;
  orderId: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<AmegoInvoiceResult> {
  return postAmego({
    endpoint: "invoice_query",
    invoice: input.invoice,
    appKey: input.appKey,
    data: {
      type: "order",
      order_id: input.orderId
    },
    apiBaseUrl: input.apiBaseUrl,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher
  });
}

export async function queryAmegoInvoiceByNumber(input: {
  invoice: string;
  appKey: string;
  invoiceNumber: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<AmegoInvoiceResult> {
  return postAmego({
    endpoint: "invoice_query",
    invoice: input.invoice,
    appKey: input.appKey,
    data: { type: "invoice", invoice_number: input.invoiceNumber },
    apiBaseUrl: input.apiBaseUrl,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher
  });
}

export async function voidAmegoInvoice(input: {
  invoice: string;
  appKey: string;
  invoiceNumber: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<AmegoInvoiceResult> {
  return postAmego({
    endpoint: "f0501",
    invoice: input.invoice,
    appKey: input.appKey,
    data: [{ CancelInvoiceNumber: input.invoiceNumber }],
    apiBaseUrl: input.apiBaseUrl,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher
  });
}

export function sanitizeAmegoResponse(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(value);
}

async function postAmego(input: {
  endpoint: string;
  invoice: string;
  appKey: string;
  data: Record<string, unknown> | Array<Record<string, unknown>>;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<AmegoInvoiceResult> {
  const data = JSON.stringify(input.data);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const form = new URLSearchParams({
    invoice: input.invoice,
    data,
    time: timestamp,
    sign: createAmegoSignature(data, timestamp, input.appKey)
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await (input.fetcher ?? fetch)(
      `${normalizeBaseUrl(input.apiBaseUrl)}/${input.endpoint}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new AmegoTransportError("amego_timeout");
    }
    throw new AmegoTransportError("amego_http_error");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AmegoTransportError("amego_http_error", response.status);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AmegoTransportError("amego_invalid_response", response.status);
  }
  if (!isRecord(raw)) {
    throw new AmegoTransportError("amego_invalid_response", response.status);
  }
  return normalizeAmegoResult(raw);
}

function normalizeAmegoResult(raw: Record<string, unknown>): AmegoInvoiceResult {
  const nested = isRecord(raw.data) ? raw.data : null;
  const field = (name: string): unknown => nested?.[name] ?? raw[name];
  const codeValue = raw.code ?? nested?.code;

  return {
    code: codeValue == null ? "" : String(codeValue),
    message: stringValue(raw.msg ?? raw.message ?? nested?.msg ?? nested?.message),
    invoiceNumber: stringValue(field("invoice_number")),
    invoiceDate: stringValue(field("invoice_date")),
    invoiceTime: stringOrNumberValue(field("invoice_time")),
    randomNumber: stringValue(field("random_number")),
    barcode: stringValue(field("barcode")),
    qrcodeLeft: stringValue(field("qrcode_left")),
    qrcodeRight: stringValue(field("qrcode_right")),
    raw
  };
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || DEFAULT_AMEGO_API_BASE_URL).replace(/\/+$/, "");
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function stringOrNumberValue(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return stringValue(value);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["base64_data", "sign", "app_key", "appKey"].includes(key))
      .map(([key, item]) => [key, sanitizeValue(item)])
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (isRecord(value)) {
    return sanitizeRecord(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
