PRAGMA foreign_keys = OFF;

CREATE TABLE devices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO devices_new (
  id, company_id, name, token, platform, last_seen_at, created_at, updated_at
)
SELECT
  id, company_id, name, token, platform, last_seen_at, created_at, updated_at
FROM devices;

CREATE TABLE invoices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  random_number TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  seller_name TEXT,
  seller_identifier TEXT NOT NULL,
  buyer_identifier TEXT,
  total_amount INTEGER NOT NULL,
  amego_response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO invoices_new (
  id, company_id, invoice_number, random_number, issued_at,
  seller_name, seller_identifier, buyer_identifier, total_amount,
  amego_response_json, created_at, updated_at
)
SELECT
  id, company_id, invoice_number, random_number, issued_at,
  seller_name, seller_identifier, buyer_identifier, total_amount,
  amego_response_json, created_at, updated_at
FROM invoices;

CREATE TABLE print_jobs_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices_new(id) ON DELETE SET NULL,
  invoice_id TEXT REFERENCES invoices_new(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL,
  last_error TEXT,
  printed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO print_jobs_new (
  id, company_id, device_id, invoice_id, status, payload_json,
  last_error, printed_at, created_at, updated_at
)
SELECT
  id, company_id, device_id, invoice_id, status, payload_json,
  last_error, printed_at, created_at, updated_at
FROM print_jobs;

DROP TABLE print_jobs;
DROP TABLE invoices;
DROP TABLE devices;
DROP TABLE stores;

ALTER TABLE devices_new RENAME TO devices;
ALTER TABLE invoices_new RENAME TO invoices;
ALTER TABLE print_jobs_new RENAME TO print_jobs;

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token);
CREATE INDEX IF NOT EXISTS idx_print_jobs_device_status ON print_jobs(device_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_company_status ON print_jobs(company_id, status, created_at);

PRAGMA foreign_keys = ON;
