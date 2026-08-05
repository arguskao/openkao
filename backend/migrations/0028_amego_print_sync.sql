ALTER TABLE print_jobs ADD COLUMN amego_print_sync_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE print_jobs ADD COLUMN amego_print_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN amego_print_last_error TEXT;
ALTER TABLE print_jobs ADD COLUMN amego_print_next_retry_at TEXT;
ALTER TABLE print_jobs ADD COLUMN amego_print_synced_at TEXT;

CREATE INDEX idx_print_jobs_amego_sync_retry
ON print_jobs(amego_print_sync_status, amego_print_next_retry_at, created_at);

CREATE TRIGGER trg_print_jobs_amego_sync_integrity_insert
BEFORE INSERT ON print_jobs
WHEN NEW.amego_print_sync_status NOT IN ('not_required', 'pending', 'synced', 'manual_review')
  OR NEW.amego_print_attempt_count < 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_amego_sync_integrity_check_failed');
END;

CREATE TRIGGER trg_print_jobs_amego_sync_integrity_update
BEFORE UPDATE ON print_jobs
WHEN NEW.amego_print_sync_status NOT IN ('not_required', 'pending', 'synced', 'manual_review')
  OR NEW.amego_print_attempt_count < 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_amego_sync_integrity_check_failed');
END;

-- Backfill only the earliest completed original print for each official Amego
-- invoice. Historical reprints do not need to be replayed merely to change the
-- invoice's print_mark from N to Y.
UPDATE print_jobs
SET amego_print_sync_status = 'pending',
    amego_print_next_retry_at = CURRENT_TIMESTAMP
WHERE status = 'printed'
  AND COALESCE(json_extract(payload_json, '$.isReprint'), 0) = 0
  AND EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i.id = print_jobs.invoice_id
      AND i.company_id = print_jobs.company_id
      AND i.amego_order_id IS NOT NULL
  )
  AND id = (
    SELECT candidate.id
    FROM print_jobs candidate
    WHERE candidate.company_id = print_jobs.company_id
      AND candidate.invoice_id = print_jobs.invoice_id
      AND candidate.status = 'printed'
      AND COALESCE(json_extract(candidate.payload_json, '$.isReprint'), 0) = 0
    ORDER BY candidate.created_at ASC, candidate.id ASC
    LIMIT 1
  );
