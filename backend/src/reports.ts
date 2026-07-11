import type { SalesInvoiceHeaderRow, SalesInvoiceRow, SalesSummaryRow, UserSession } from "./domain-types";
import { HttpError, json } from "./http";
import {
  encodeSalesReportCursor,
  enforceReportDateRange,
  normalizePrintStatusValue,
  normalizeReportDate,
  normalizeReportLimit,
  parseSalesReportCursor,
  reportDateBounds,
  salesPrintStatusTitle
} from "./request-parsers";
import type { Env } from "./types";

export async function listSalesReport(env: Env, session: UserSession, url: URL): Promise<Response> {
  const startDate = normalizeReportDate(url.searchParams.get("startDate"), "startDate");
  const endDate = normalizeReportDate(url.searchParams.get("endDate"), "endDate");

  if (startDate > endDate) {
    throw new HttpError(400, "date_range_invalid");
  }

  enforceReportDateRange(startDate, endDate);
  const pageLimit = normalizeReportLimit(url.searchParams.get("limit"));
  const cursor = parseSalesReportCursor(url.searchParams.get("cursor"));
  const { startInclusive, endExclusive } = reportDateBounds(startDate, endDate);

  const [invoiceHeadersResult, invoiceItemsResult, productSummaryResult, statusSummaryResult] = await Promise.all([
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       )
       SELECT
         i.id AS invoice_id,
         i.invoice_number,
         i.random_number,
         i.issued_at,
         i.seller_name,
         i.seller_identifier,
         i.buyer_identifier,
         i.total_amount,
         ranked_print_jobs.status AS print_status
       FROM invoices i
       LEFT JOIN ranked_print_jobs
         ON ranked_print_jobs.invoice_id = i.id
        AND ranked_print_jobs.row_number = 1
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
         AND (
           ? IS NULL
           OR i.issued_at < ?
           OR (i.issued_at = ? AND i.id < ?)
         )
       ORDER BY i.issued_at DESC, i.id DESC
       LIMIT ?`
    )
      .bind(
        session.company_id,
        session.company_id,
        startInclusive,
        endExclusive,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.invoiceId ?? null,
        pageLimit
      )
      .all<SalesInvoiceHeaderRow>(),
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       ),
       paged_invoices AS (
         SELECT
           i.id AS invoice_id,
           i.invoice_number,
           i.random_number,
           i.issued_at,
           i.seller_name,
           i.seller_identifier,
           i.buyer_identifier,
           i.total_amount,
           ranked_print_jobs.status AS print_status
         FROM invoices i
         LEFT JOIN ranked_print_jobs
           ON ranked_print_jobs.invoice_id = i.id
          AND ranked_print_jobs.row_number = 1
         WHERE i.company_id = ?
           AND i.issued_at >= ?
           AND i.issued_at < ?
           AND (
             ? IS NULL
             OR i.issued_at < ?
             OR (i.issued_at = ? AND i.id < ?)
           )
         ORDER BY i.issued_at DESC, i.id DESC
         LIMIT ?
       )
       SELECT
         paged_invoices.invoice_id,
         paged_invoices.invoice_number,
         paged_invoices.random_number,
         paged_invoices.issued_at,
         paged_invoices.seller_name,
         paged_invoices.seller_identifier,
         paged_invoices.buyer_identifier,
         paged_invoices.total_amount,
         paged_invoices.print_status,
         ii.id AS item_id,
         ii.name AS item_name,
         ii.quantity AS item_quantity,
         ii.unit_price AS item_unit_price,
         ii.amount AS item_amount
       FROM paged_invoices
       LEFT JOIN invoice_items ii ON ii.invoice_id = paged_invoices.invoice_id
       ORDER BY paged_invoices.issued_at DESC, paged_invoices.invoice_id DESC, ii.rowid ASC`
    )
      .bind(
        session.company_id,
        session.company_id,
        startInclusive,
        endExclusive,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.issuedAt ?? null,
        cursor?.invoiceId ?? null,
        pageLimit
      )
      .all<SalesInvoiceRow>(),
    env.DB.prepare(
      `SELECT
         ii.name AS name,
         SUM(ii.quantity) AS quantity,
         SUM(ii.amount) AS total
       FROM invoices i
       JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
       GROUP BY ii.name
       ORDER BY total DESC, ii.name ASC`
    )
      .bind(session.company_id, startInclusive, endExclusive)
      .all<SalesSummaryRow>(),
    env.DB.prepare(
      `WITH ranked_print_jobs AS (
         SELECT
           invoice_id,
           status,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_id
             ORDER BY created_at DESC, id DESC
           ) AS row_number
         FROM print_jobs
         WHERE company_id = ?
       )
       SELECT
         COALESCE(ranked_print_jobs.status, 'pending') AS name,
         COUNT(*) AS quantity,
         SUM(i.total_amount) AS total
       FROM invoices i
       LEFT JOIN ranked_print_jobs
         ON ranked_print_jobs.invoice_id = i.id
        AND ranked_print_jobs.row_number = 1
       WHERE i.company_id = ?
         AND i.issued_at >= ?
         AND i.issued_at < ?
       GROUP BY COALESCE(ranked_print_jobs.status, 'pending')
       ORDER BY total DESC, name ASC`
    )
      .bind(session.company_id, session.company_id, startInclusive, endExclusive)
      .all<SalesSummaryRow>()
  ]);

  const invoices = new Map<string, {
    id: string;
    invoiceNumber: string;
    randomNumber: string;
    issuedAt: string;
    sellerName: string | null;
    sellerIdentifier: string | null;
    buyerIdentifier: string | null;
    totalAmount: number;
    printStatus: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
  }>();

  for (const row of invoiceItemsResult.results) {
    if (!invoices.has(row.invoice_id)) {
      invoices.set(row.invoice_id, {
        id: row.invoice_id,
        invoiceNumber: row.invoice_number,
        randomNumber: row.random_number,
        issuedAt: row.issued_at,
        sellerName: row.seller_name,
        sellerIdentifier: row.seller_identifier,
        buyerIdentifier: row.buyer_identifier,
        totalAmount: Number(row.total_amount ?? 0),
        printStatus: normalizePrintStatusValue(row.print_status),
        items: []
      });
    }

    if (row.item_id && row.item_name) {
      invoices.get(row.invoice_id)?.items.push({
        id: row.item_id,
        name: row.item_name,
        quantity: Number(row.item_quantity ?? 0),
        unitPrice: Number(row.item_unit_price ?? 0),
        amount: Number(row.item_amount ?? 0)
      });
    }
  }

  const headerRows = invoiceHeadersResult.results;
  const nextCursor = headerRows.length < pageLimit
    ? null
    : encodeSalesReportCursor({
        issuedAt: headerRows[headerRows.length - 1].issued_at,
        invoiceId: headerRows[headerRows.length - 1].invoice_id
      });

  return json({
    report: {
      byProduct: productSummaryResult.results.map(mapSalesSummaryRow),
      byStatus: statusSummaryResult.results.map((row) => mapSalesSummaryRow({
        ...row,
        name: salesPrintStatusTitle(row.name)
      })),
      totalQuantity: productSummaryResult.results.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
      totalAmount: statusSummaryResult.results.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
    },
    invoices: Array.from(invoices.values()),
    nextCursor
  });
}

function mapSalesSummaryRow(row: SalesSummaryRow) {
  return {
    name: row.name,
    quantity: Number(row.quantity ?? 0),
    total: Number(row.total ?? 0)
  };
}
