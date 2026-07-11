ALTER TABLE print_jobs ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_company_idempotency
ON print_jobs(company_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
