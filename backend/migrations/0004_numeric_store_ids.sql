PRAGMA foreign_keys = OFF;

CREATE TABLE store_id_map (
  old_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
);

INSERT INTO store_id_map (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM stores;

CREATE TABLE stores_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stores_new (id, company_id, name, address, created_at, updated_at)
SELECT
  m.new_id,
  s.company_id,
  s.name,
  s.address,
  s.created_at,
  s.updated_at
FROM stores s
JOIN store_id_map m ON m.old_id = s.id
ORDER BY m.new_id;

CREATE TABLE devices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id INTEGER REFERENCES stores_new(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO devices_new (id, company_id, store_id, name, token, platform, last_seen_at, created_at, updated_at)
SELECT
  d.id,
  d.company_id,
  m.new_id,
  d.name,
  d.token,
  d.platform,
  d.last_seen_at,
  d.created_at,
  d.updated_at
FROM devices d
LEFT JOIN store_id_map m ON m.old_id = d.store_id;

CREATE TABLE invoices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id INTEGER REFERENCES stores_new(id) ON DELETE SET NULL,
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
  id, company_id, store_id, invoice_number, random_number, issued_at,
  seller_name, seller_identifier, buyer_identifier, total_amount,
  amego_response_json, created_at, updated_at
)
SELECT
  i.id,
  i.company_id,
  m.new_id,
  i.invoice_number,
  i.random_number,
  i.issued_at,
  i.seller_name,
  i.seller_identifier,
  i.buyer_identifier,
  i.total_amount,
  i.amego_response_json,
  i.created_at,
  i.updated_at
FROM invoices i
LEFT JOIN store_id_map m ON m.old_id = i.store_id;

CREATE TABLE print_jobs_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id INTEGER REFERENCES stores_new(id) ON DELETE SET NULL,
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
  id, company_id, store_id, device_id, invoice_id, status, payload_json,
  last_error, printed_at, created_at, updated_at
)
SELECT
  p.id,
  p.company_id,
  m.new_id,
  p.device_id,
  p.invoice_id,
  p.status,
  p.payload_json,
  p.last_error,
  p.printed_at,
  p.created_at,
  p.updated_at
FROM print_jobs p
LEFT JOIN store_id_map m ON m.old_id = p.store_id;

DROP TABLE print_jobs;
DROP TABLE invoices;
DROP TABLE devices;
DROP TABLE stores;

ALTER TABLE stores_new RENAME TO stores;
ALTER TABLE devices_new RENAME TO devices;
ALTER TABLE invoices_new RENAME TO invoices;
ALTER TABLE print_jobs_new RENAME TO print_jobs;

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token);
CREATE INDEX IF NOT EXISTS idx_print_jobs_device_status ON print_jobs(device_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_company_status ON print_jobs(company_id, status, created_at);

DROP TABLE store_id_map;

PRAGMA foreign_keys = ON;
