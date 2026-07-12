ALTER TABLE companies ADD COLUMN amego_printer_type INTEGER;
ALTER TABLE companies ADD COLUMN amego_printer_lang INTEGER NOT NULL DEFAULT 2;

CREATE TABLE invoice_issuances (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issuing',
  request_json TEXT NOT NULL,
  response_json TEXT,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, order_id),
  UNIQUE(company_id, idempotency_key)
);

ALTER TABLE invoices ADD COLUMN amego_order_id TEXT;
ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'issued';
ALTER TABLE invoices ADD COLUMN invoice_date TEXT;
ALTER TABLE invoices ADD COLUMN invoice_time TEXT;
ALTER TABLE invoices ADD COLUMN sales_amount INTEGER;
ALTER TABLE invoices ADD COLUMN tax_amount INTEGER;
ALTER TABLE invoices ADD COLUMN barcode_payload TEXT;
ALTER TABLE invoices ADD COLUMN qrcode_left TEXT;
ALTER TABLE invoices ADD COLUMN qrcode_right TEXT;
ALTER TABLE invoices ADD COLUMN carrier_type TEXT;
ALTER TABLE invoices ADD COLUMN carrier_id TEXT;
ALTER TABLE invoices ADD COLUMN npoban TEXT;
ALTER TABLE invoices ADD COLUMN amego_error_code TEXT;

CREATE UNIQUE INDEX idx_invoices_company_amego_order_id
ON invoices(company_id, amego_order_id)
WHERE amego_order_id IS NOT NULL;

CREATE INDEX idx_invoice_issuances_company_status_created
ON invoice_issuances(company_id, status, created_at DESC);

CREATE TRIGGER trg_companies_amego_printer_integrity_insert
BEFORE INSERT ON companies
WHEN (NEW.amego_printer_type IS NOT NULL AND NEW.amego_printer_type < 1)
  OR NEW.amego_printer_lang NOT IN (1, 2, 3)
BEGIN
  SELECT RAISE(ABORT, 'companies_amego_printer_integrity_check_failed');
END;

CREATE TRIGGER trg_companies_amego_printer_integrity_update
BEFORE UPDATE ON companies
WHEN (NEW.amego_printer_type IS NOT NULL AND NEW.amego_printer_type < 1)
  OR NEW.amego_printer_lang NOT IN (1, 2, 3)
BEGIN
  SELECT RAISE(ABORT, 'companies_amego_printer_integrity_check_failed');
END;

CREATE TRIGGER trg_invoice_issuances_integrity_insert
BEFORE INSERT ON invoice_issuances
WHEN NEW.status NOT IN ('issuing', 'issued', 'failed')
  OR length(trim(NEW.order_id)) = 0
  OR length(NEW.order_id) > 40
  OR length(trim(NEW.idempotency_key)) = 0
  OR length(NEW.request_hash) != 64
BEGIN
  SELECT RAISE(ABORT, 'invoice_issuances_integrity_check_failed');
END;

CREATE TRIGGER trg_invoice_issuances_integrity_update
BEFORE UPDATE ON invoice_issuances
WHEN NEW.status NOT IN ('issuing', 'issued', 'failed')
  OR (NEW.status = 'issued' AND NEW.invoice_id IS NULL)
  OR length(trim(NEW.order_id)) = 0
  OR length(NEW.order_id) > 40
  OR length(trim(NEW.idempotency_key)) = 0
  OR length(NEW.request_hash) != 64
BEGIN
  SELECT RAISE(ABORT, 'invoice_issuances_integrity_check_failed');
END;

CREATE TRIGGER trg_invoices_amego_integrity_insert
BEFORE INSERT ON invoices
WHEN NEW.status NOT IN ('issued', 'voided')
  OR (NEW.sales_amount IS NOT NULL AND (NEW.sales_amount < 0 OR NEW.sales_amount > 99999999))
  OR (NEW.tax_amount IS NOT NULL AND (NEW.tax_amount < 0 OR NEW.tax_amount > 99999999))
  OR (
    NEW.amego_order_id IS NOT NULL
    AND (
      NEW.barcode_payload IS NULL OR length(trim(NEW.barcode_payload)) = 0
      OR NEW.qrcode_left IS NULL OR length(trim(NEW.qrcode_left)) = 0
      OR NEW.qrcode_right IS NULL OR length(trim(NEW.qrcode_right)) = 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invoices_amego_integrity_check_failed');
END;

CREATE TRIGGER trg_invoices_amego_integrity_update
BEFORE UPDATE ON invoices
WHEN NEW.status NOT IN ('issued', 'voided')
  OR (NEW.sales_amount IS NOT NULL AND (NEW.sales_amount < 0 OR NEW.sales_amount > 99999999))
  OR (NEW.tax_amount IS NOT NULL AND (NEW.tax_amount < 0 OR NEW.tax_amount > 99999999))
  OR (
    NEW.amego_order_id IS NOT NULL
    AND (
      NEW.barcode_payload IS NULL OR length(trim(NEW.barcode_payload)) = 0
      OR NEW.qrcode_left IS NULL OR length(trim(NEW.qrcode_left)) = 0
      OR NEW.qrcode_right IS NULL OR length(trim(NEW.qrcode_right)) = 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invoices_amego_integrity_check_failed');
END;

CREATE TRIGGER trg_print_jobs_payload_json_insert
BEFORE INSERT ON print_jobs
WHEN json_valid(NEW.payload_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_payload_json_invalid');
END;

CREATE TRIGGER trg_print_jobs_payload_json_update
BEFORE UPDATE ON print_jobs
WHEN json_valid(NEW.payload_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_payload_json_invalid');
END;

CREATE TRIGGER trg_print_jobs_invoice_payload_match_insert
BEFORE INSERT ON print_jobs
WHEN NEW.invoice_id IS NOT NULL
  AND CASE WHEN json_valid(NEW.payload_json) = 1 THEN
    EXISTS (
      SELECT 1
      FROM invoices i
      WHERE i.id = NEW.invoice_id
        AND (
          json_extract(NEW.payload_json, '$.invoiceNumber') IS NULL
          OR json_extract(NEW.payload_json, '$.invoiceNumber') != i.invoice_number
          OR (
            i.amego_order_id IS NOT NULL
            AND (
              json_extract(NEW.payload_json, '$.barcodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.barcodePayload') != i.barcode_payload
              OR json_extract(NEW.payload_json, '$.leftQRCodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.leftQRCodePayload') != i.qrcode_left
              OR json_extract(NEW.payload_json, '$.rightQRCodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.rightQRCodePayload') != i.qrcode_right
            )
          )
        )
    )
  ELSE 0 END
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_invoice_payload_mismatch');
END;

CREATE TRIGGER trg_print_jobs_invoice_payload_match_update
BEFORE UPDATE ON print_jobs
WHEN NEW.invoice_id IS NOT NULL
  AND CASE WHEN json_valid(NEW.payload_json) = 1 THEN
    EXISTS (
      SELECT 1
      FROM invoices i
      WHERE i.id = NEW.invoice_id
        AND (
          json_extract(NEW.payload_json, '$.invoiceNumber') IS NULL
          OR json_extract(NEW.payload_json, '$.invoiceNumber') != i.invoice_number
          OR (
            i.amego_order_id IS NOT NULL
            AND (
              json_extract(NEW.payload_json, '$.barcodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.barcodePayload') != i.barcode_payload
              OR json_extract(NEW.payload_json, '$.leftQRCodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.leftQRCodePayload') != i.qrcode_left
              OR json_extract(NEW.payload_json, '$.rightQRCodePayload') IS NULL
              OR json_extract(NEW.payload_json, '$.rightQRCodePayload') != i.qrcode_right
            )
          )
        )
    )
  ELSE 0 END
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_invoice_payload_mismatch');
END;
