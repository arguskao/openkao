import { MAX_INVOICE_ITEMS, MAX_MONEY_AMOUNT, MAX_REPORT_RANGE_DAYS } from "./constants";
import type { PrintJobPayload } from "./domain-types";
import { HttpError } from "./http";
import { requireArray, requireIntegerRange, requireString } from "./validation";

export function parsePositiveId(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[1-9]\d*$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  throw new HttpError(400, `${field}_invalid`);
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeDeviceName(value: unknown): string {
  return normalizeRequiredBoundedString(value, "name", 60);
}

export function normalizeDevicePlatform(value: unknown): string {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? "ios";
  return normalized === "" ? "ios" : normalizeRequiredBoundedString(normalized, "platform", 20).toLowerCase();
}

export function hasConfiguredAppKey(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function normalizeInstallationId(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "installationId", 64);
  if (!/^[A-Za-z0-9-]+$/.test(normalized)) {
    throw new HttpError(400, "installationId_invalid");
  }
  return normalized;
}

export function normalizeOptionalInstallationId(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = normalizeOptionalString(value);
  return normalized == null ? null : normalizeInstallationId(normalized);
}

export function generateUnbindCode(): string {
  return Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0");
}

export function normalizeRequiredBoundedString(value: unknown, field: string, maxLength: number): string {
  requireString(value, field);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field}_too_long`);
  }
  return normalized;
}

export function normalizeOptionalBoundedString(value: unknown, maxLength: number): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, "string_too_long");
  }
  return normalized;
}

export function normalizeInvoiceNumber(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "invoiceNumber", 10).toUpperCase();
  if (!/^[A-Z]{2}\d{8}$/.test(normalized)) {
    throw new HttpError(400, "invoiceNumber_invalid");
  }
  return normalized;
}

export function normalizeRandomNumber(value: unknown): string {
  const normalized = normalizeRequiredBoundedString(value, "randomNumber", 4);
  if (!/^\d{4}$/.test(normalized)) {
    throw new HttpError(400, "randomNumber_invalid");
  }
  return normalized;
}

export function normalizeCompanyIdentifier(value: unknown, field: string): string {
  const normalized = normalizeRequiredBoundedString(value, field, 8);
  if (!/^\d{8}$/.test(normalized)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return normalized;
}

export function normalizeOptionalCompanyIdentifier(value: unknown, field: string): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized == null) {
    return null;
  }
  if (!/^\d{8}$/.test(normalized)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return normalized;
}

export function normalizeIssuedAt(value: unknown): string {
  if (value == null) {
    return new Date().toISOString();
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "issuedAt_invalid");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "issuedAt_invalid");
  }
  return parsed.toISOString();
}

export function normalizeReportDate(value: string | null, field: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field}_invalid`);
  }
  return value;
}

export function normalizeReportLimit(value: string | null): number {
  if (value == null) {
    return 100;
  }

  if (!/^\d+$/.test(value.trim())) {
    throw new HttpError(400, "report_limit_invalid");
  }

  const numeric = Number(value.trim());
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new HttpError(400, "report_limit_invalid");
  }

  return numeric;
}

export function reportDateBounds(startDate: string, endDate: string) {
  const startInclusive = `${startDate}T00:00:00.000Z`;
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endExclusive = end.toISOString();
  return { startInclusive, endExclusive };
}

export function parseSalesReportCursor(value: string | null): { issuedAt: string; invoiceId: string } | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(value)) as { issuedAt?: unknown; invoiceId?: unknown };
    if (typeof decoded.issuedAt !== "string" || decoded.issuedAt.trim() === "") {
      throw new HttpError(400, "report_cursor_invalid");
    }
    if (typeof decoded.invoiceId !== "string" || decoded.invoiceId.trim() === "") {
      throw new HttpError(400, "report_cursor_invalid");
    }
    return {
      issuedAt: decoded.issuedAt,
      invoiceId: decoded.invoiceId
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "report_cursor_invalid");
  }
}

export function encodeSalesReportCursor(input: { issuedAt: string; invoiceId: string }): string {
  return btoa(JSON.stringify(input));
}

export function normalizeStatus(value: unknown): string {
  if (value == null) {
    return "顯示";
  }
  if (value === "顯示" || value === "隱藏") {
    return value;
  }
  throw new HttpError(400, "status_invalid");
}

export function normalizeAuditLogLimit(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new HttpError(400, "limit_invalid");
  }
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new HttpError(400, "limit_invalid");
  }
  return numeric;
}

export function normalizePrintStatusValue(value: unknown): string {
  return value === "printed" || value === "failed" || value === "printing" ? value : "pending";
}

export function salesPrintStatusTitle(value: string): string {
  switch (value) {
    case "printing":
      return "傳送中";
    case "printed":
      return "已列印";
    case "failed":
      return "列印失敗";
    default:
      return "待列印";
  }
}

export function normalizeTaxType(value: unknown): string {
  if (value == null) {
    return "含稅";
  }
  if (value === "含稅" || value === "未稅") {
    return value;
  }
  throw new HttpError(400, "tax_type_invalid");
}

export function normalizeSortOrder(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "sort_order_invalid");
  }
  return value;
}

export function normalizeDecimalPlaces(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4) {
    throw new HttpError(400, "decimal_places_invalid");
  }

  return value;
}

export function integerPower10(exponent: number): number {
  let output = 1;
  for (let index = 0; index < exponent; index += 1) {
    output *= 10;
  }
  return output;
}

export function enforceReportDateRange(startDate: string, endDate: string): void {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) {
    throw new HttpError(400, "date_range_invalid");
  }
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays > MAX_REPORT_RANGE_DAYS) {
    throw new HttpError(400, "date_range_too_large");
  }
}

export function parsePayload(payload: string): PrintJobPayload {
  return JSON.parse(payload) as PrintJobPayload;
}

export function parseOptionalJson(payload: string | null): unknown {
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return payload;
  }
}

export function parseRegisterAccountBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 80),
    phone: normalizeOptionalBoundedString(body.phone, 40) ?? undefined,
    account: normalizeRequiredBoundedString(body.account, "account", 32),
    password: normalizeRequiredBoundedString(body.password, "password", 128),
    companyName: normalizeRequiredBoundedString(body.companyName, "companyName", 100),
    taxId: normalizeRequiredBoundedString(body.taxId, "taxId", 8),
    address: normalizeOptionalBoundedString(body.address, 255) ?? undefined,
    deviceName: normalizeOptionalBoundedString(body.deviceName, 60) ?? undefined,
    installationId: normalizeRequiredBoundedString(body.installationId, "installationId", 64),
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

export function parseLoginAccountBody(body: Record<string, unknown>) {
  return {
    account: normalizeRequiredBoundedString(body.account, "account", 32),
    password: normalizeRequiredBoundedString(body.password, "password", 128),
    deviceName: normalizeOptionalBoundedString(body.deviceName, 60) ?? undefined,
    installationId: normalizeRequiredBoundedString(body.installationId, "installationId", 64),
    unbindCode: normalizeOptionalBoundedString(body.unbindCode, 8) ?? undefined,
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

export function parseCatalogCategoryBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    sortOrder: body.sortOrder,
    status: body.status
  };
}

export function parseCatalogProductBody(body: Record<string, unknown>) {
  requireIntegerRange(body.price, "price", { min: 0, max: MAX_MONEY_AMOUNT });
  return {
    categoryId: body.categoryId as number | string | null | undefined,
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    price: body.price,
    imagePath: normalizeOptionalBoundedString(body.imagePath, 255),
    status: body.status,
    taxType: body.taxType,
    sortOrder: body.sortOrder
  };
}

export function parseCreatePrintJobBody(body: Record<string, unknown>) {
  requireIntegerRange(body.totalAmount, "totalAmount", { min: 0, max: MAX_MONEY_AMOUNT });
  requireArray(body.items, "items", { min: 1, max: MAX_INVOICE_ITEMS });

  return {
    companyId: body.companyId as number | string,
    deviceId: normalizeOptionalBoundedString(body.deviceId, 64) ?? undefined,
    idempotencyKey: normalizeOptionalBoundedString(body.idempotencyKey, 128) ?? undefined,
    invoiceNumber: normalizeRequiredBoundedString(body.invoiceNumber, "invoiceNumber", 10),
    randomNumber: normalizeRequiredBoundedString(body.randomNumber, "randomNumber", 4),
    issuedAt: normalizeOptionalBoundedString(body.issuedAt, 40) ?? undefined,
    sellerName: normalizeOptionalBoundedString(body.sellerName, 100) ?? undefined,
    sellerIdentifier: normalizeRequiredBoundedString(body.sellerIdentifier, "sellerIdentifier", 8),
    buyerIdentifier: normalizeOptionalBoundedString(body.buyerIdentifier, 8) ?? undefined,
    totalAmount: body.totalAmount,
    items: body.items as Array<{ name: string; quantity: number; unitPrice: number }>,
    qrCodePayload: normalizeOptionalBoundedString(body.qrCodePayload, 4096) ?? undefined,
    barcodePayload: normalizeOptionalBoundedString(body.barcodePayload, 64) ?? undefined
  };
}

export function parseManagedDeviceBody(body: Record<string, unknown>) {
  return {
    name: normalizeRequiredBoundedString(body.name, "name", 60),
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined,
    installationId: normalizeOptionalBoundedString(body.installationId, 64)
  };
}

export function parseManagedDeviceUpdateBody(body: Record<string, unknown>) {
  return {
    name: normalizeOptionalBoundedString(body.name, 60) ?? undefined,
    platform: normalizeOptionalBoundedString(body.platform, 20) ?? undefined
  };
}

export function parseAdminProductBody(body: Record<string, unknown>) {
  requireIntegerRange(body.price, "price", { min: 0, max: MAX_MONEY_AMOUNT });
  return {
    companyId: body.companyId as number | string,
    categoryId: body.categoryId as number | string | null | undefined,
    name: normalizeRequiredBoundedString(body.name, "name", 100),
    price: body.price,
    imagePath: normalizeOptionalBoundedString(body.imagePath, 255),
    status: body.status,
    taxType: body.taxType,
    sortOrder: body.sortOrder
  };
}

export function parseResetPasswordBody(body: Record<string, unknown>) {
  return {
    password: normalizeRequiredBoundedString(body.password, "password", 128)
  };
}

export function parsePrintJobStatusBody(body: Record<string, unknown>) {
  return {
    message: normalizeOptionalBoundedString(body.message, 255) ?? undefined
  };
}
