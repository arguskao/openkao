PRAGMA foreign_keys = OFF;

CREATE TABLE company_id_map (
  old_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
);

INSERT INTO company_id_map (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM companies;

CREATE TABLE category_id_map (
  old_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
);

INSERT INTO category_id_map (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM categories;

CREATE TABLE product_id_map (
  old_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
);

INSERT INTO product_id_map (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM products;

CREATE TABLE companies_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  amego_invoice_no TEXT,
  amego_app_key_secret_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO companies_new (id, name, tax_id, amego_invoice_no, amego_app_key_secret_name, created_at, updated_at)
SELECT
  m.new_id,
  c.name,
  c.tax_id,
  c.amego_invoice_no,
  c.amego_app_key_secret_name,
  c.created_at,
  c.updated_at
FROM companies c
JOIN company_id_map m ON m.old_id = c.id
ORDER BY m.new_id;

CREATE TABLE stores_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stores_new (id, company_id, name, address, created_at, updated_at)
SELECT
  s.id,
  m.new_id,
  s.name,
  s.address,
  s.created_at,
  s.updated_at
FROM stores s
JOIN company_id_map m ON m.old_id = s.company_id;

CREATE TABLE devices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores_new(id) ON DELETE SET NULL,
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
  m.new_id,
  d.store_id,
  d.name,
  d.token,
  d.platform,
  d.last_seen_at,
  d.created_at,
  d.updated_at
FROM devices d
JOIN company_id_map m ON m.old_id = d.company_id;

CREATE TABLE categories_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '顯示',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories_new (id, company_id, name, sort_order, status, created_at, updated_at)
SELECT
  cm.new_id,
  pm.new_id,
  c.name,
  c.sort_order,
  COALESCE(c.status, '顯示'),
  c.created_at,
  c.updated_at
FROM categories c
JOIN category_id_map cm ON cm.old_id = c.id
JOIN company_id_map pm ON pm.old_id = c.company_id
ORDER BY cm.new_id;

CREATE TABLE products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories_new(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  image_path TEXT,
  tax_type TEXT NOT NULL DEFAULT '含稅',
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO products_new (id, company_id, category_id, name, price, is_active, created_at, updated_at, image_path, tax_type, sort_order)
SELECT
  pm.new_id,
  cm.new_id,
  catm.new_id,
  p.name,
  p.price,
  p.is_active,
  p.created_at,
  p.updated_at,
  p.image_path,
  COALESCE(p.tax_type, '含稅'),
  COALESCE(p.sort_order, 0)
FROM products p
JOIN product_id_map pm ON pm.old_id = p.id
JOIN company_id_map cm ON cm.old_id = p.company_id
LEFT JOIN category_id_map catm ON catm.old_id = p.category_id
ORDER BY pm.new_id;

CREATE TABLE invoices_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores_new(id) ON DELETE SET NULL,
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
  m.new_id,
  i.store_id,
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
JOIN company_id_map m ON m.old_id = i.company_id;

CREATE TABLE print_jobs_new (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies_new(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores_new(id) ON DELETE SET NULL,
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
  m.new_id,
  p.store_id,
  p.device_id,
  p.invoice_id,
  p.status,
  p.payload_json,
  p.last_error,
  p.printed_at,
  p.created_at,
  p.updated_at
FROM print_jobs p
JOIN company_id_map m ON m.old_id = p.company_id;

DROP TABLE print_jobs;
DROP TABLE invoices;
DROP TABLE products;
DROP TABLE categories;
DROP TABLE devices;
DROP TABLE stores;
DROP TABLE companies;

ALTER TABLE companies_new RENAME TO companies;
ALTER TABLE stores_new RENAME TO stores;
ALTER TABLE devices_new RENAME TO devices;
ALTER TABLE categories_new RENAME TO categories;
ALTER TABLE products_new RENAME TO products;
ALTER TABLE invoices_new RENAME TO invoices;
ALTER TABLE print_jobs_new RENAME TO print_jobs;

CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token);
CREATE INDEX IF NOT EXISTS idx_print_jobs_device_status ON print_jobs(device_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_company_status ON print_jobs(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_categories_company_sort ON categories(company_id, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_products_company_category_sort ON products(company_id, category_id, sort_order, name);

DROP TABLE product_id_map;
DROP TABLE category_id_map;
DROP TABLE company_id_map;

PRAGMA foreign_keys = ON;
