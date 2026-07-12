ALTER TABLE invoices ADD COLUMN voided_at TEXT;
ALTER TABLE invoices ADD COLUMN amego_void_response_json TEXT;

CREATE INDEX idx_invoices_company_status_issued
ON invoices(company_id, status, issued_at DESC, id DESC);

CREATE TRIGGER trg_invoices_void_record_insert
BEFORE INSERT ON invoices
WHEN (NEW.status = 'voided' AND NEW.voided_at IS NULL)
  OR (NEW.status != 'voided' AND NEW.voided_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invoices_void_record_check_failed');
END;

CREATE TRIGGER trg_invoices_void_record_update
BEFORE UPDATE ON invoices
WHEN (NEW.status = 'voided' AND NEW.voided_at IS NULL)
  OR (NEW.status != 'voided' AND NEW.voided_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invoices_void_record_check_failed');
END;
