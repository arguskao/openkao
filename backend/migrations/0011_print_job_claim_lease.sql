ALTER TABLE print_jobs ADD COLUMN claimed_by TEXT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE print_jobs ADD COLUMN claimed_at TEXT;
ALTER TABLE print_jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE print_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_print_jobs_claimed_by_status ON print_jobs(claimed_by, status, lease_expires_at, created_at);
