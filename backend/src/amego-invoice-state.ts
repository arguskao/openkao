import type { AmegoInvoiceStatusResult } from "./amego";
import { HttpError } from "./http";

const VOID_TYPES = new Set(["C0501", "A0501", "A0201", "A0202"]);
const CANCEL_TYPES = new Set(["C0701"]);

export function requireAmegoInvoiceIssued(
  result: AmegoInvoiceStatusResult,
  expectedInvoiceNumber: string
): void {
  const invoiceType = result.invoiceType?.toUpperCase() ?? null;
  const resultCode = result.code.toUpperCase();
  const waitingTypes = result.waitingInvoiceTypes.map((value) => value.toUpperCase());

  if (resultCode === "52" || waitingTypes.some((value) => VOID_TYPES.has(value) || CANCEL_TYPES.has(value))) {
    throw new HttpError(409, "amego_invoice_change_pending");
  }
  if (resultCode === "71" || resultCode === "NOT_FOUND" || invoiceType === "NOT_FOUND") {
    throw new HttpError(409, "amego_invoice_not_issued");
  }
  if (resultCode !== "0") {
    throw new HttpError(502, "amego_invoice_status_unavailable", {
      details: { amegoCode: result.code || "invalid_response" }
    });
  }
  if (!result.invoiceNumber) {
    throw new HttpError(409, "amego_invoice_not_issued");
  }
  if (result.invoiceNumber !== expectedInvoiceNumber) {
    throw new HttpError(409, "amego_invoice_number_mismatch");
  }
  if (invoiceType != null && VOID_TYPES.has(invoiceType)) {
    throw new HttpError(409, "invoice_voided");
  }
  if (invoiceType != null && CANCEL_TYPES.has(invoiceType)) {
    throw new HttpError(409, "amego_invoice_cancelled");
  }
  if (isNonZeroValue(result.cancelDate)) {
    throw new HttpError(409, "invoice_voided");
  }
  if (result.invoiceStatus === 91) {
    throw new HttpError(409, "amego_invoice_status_error");
  }
  if (invoiceType !== "C0401") {
    throw new HttpError(409, "amego_invoice_type_unsupported", {
      details: { invoiceType: invoiceType ?? "missing" }
    });
  }
}

export function amegoInvoiceStatusAuditDetails(
  result: AmegoInvoiceStatusResult,
  operation: "void" | "reprint" | "print_sync"
): Record<string, unknown> {
  return {
    operation,
    amegoCode: result.code,
    invoiceNumber: result.invoiceNumber,
    invoiceType: result.invoiceType,
    invoiceStatus: result.invoiceStatus,
    printMark: result.printMark,
    waitingInvoiceTypes: result.waitingInvoiceTypes
  };
}

function isNonZeroValue(value: string | null): boolean {
  return value != null && value !== "" && value !== "0";
}
