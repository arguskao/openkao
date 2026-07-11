CREATE TRIGGER IF NOT EXISTS trg_companies_integrity_insert
BEFORE INSERT ON companies
WHEN NEW.price_decimal_places < 0
  OR NEW.price_decimal_places > 4
  OR (NEW.unbind_code IS NOT NULL AND NEW.unbind_code NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'companies_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_companies_integrity_update
BEFORE UPDATE ON companies
WHEN NEW.price_decimal_places < 0
  OR NEW.price_decimal_places > 4
  OR (NEW.unbind_code IS NOT NULL AND NEW.unbind_code NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
BEGIN
  SELECT RAISE(ABORT, 'companies_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_integrity_insert
BEFORE INSERT ON users
WHEN NEW.role NOT IN ('owner', 'staff', 'printer')
BEGIN
  SELECT RAISE(ABORT, 'users_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_integrity_update
BEFORE UPDATE ON users
WHEN NEW.role NOT IN ('owner', 'staff', 'printer')
BEGIN
  SELECT RAISE(ABORT, 'users_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_integrity_insert
BEFORE INSERT ON categories
WHEN NEW.sort_order < 0
  OR NEW.status NOT IN ('顯示', '隱藏')
BEGIN
  SELECT RAISE(ABORT, 'categories_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_integrity_update
BEFORE UPDATE ON categories
WHEN NEW.sort_order < 0
  OR NEW.status NOT IN ('顯示', '隱藏')
BEGIN
  SELECT RAISE(ABORT, 'categories_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_integrity_insert
BEFORE INSERT ON products
WHEN NEW.price < 0
  OR NEW.price > 99999999
  OR NEW.decimal_places < 0
  OR NEW.decimal_places > 4
  OR NEW.is_active NOT IN (0, 1)
  OR NEW.tax_type NOT IN ('含稅', '未稅')
  OR NEW.sort_order < 0
BEGIN
  SELECT RAISE(ABORT, 'products_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_integrity_update
BEFORE UPDATE ON products
WHEN NEW.price < 0
  OR NEW.price > 99999999
  OR NEW.decimal_places < 0
  OR NEW.decimal_places > 4
  OR NEW.is_active NOT IN (0, 1)
  OR NEW.tax_type NOT IN ('含稅', '未稅')
  OR NEW.sort_order < 0
BEGIN
  SELECT RAISE(ABORT, 'products_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_integrity_insert
BEFORE INSERT ON invoices
WHEN NEW.total_amount < 0
  OR NEW.total_amount > 99999999
BEGIN
  SELECT RAISE(ABORT, 'invoices_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_integrity_update
BEFORE UPDATE ON invoices
WHEN NEW.total_amount < 0
  OR NEW.total_amount > 99999999
BEGIN
  SELECT RAISE(ABORT, 'invoices_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_items_integrity_insert
BEFORE INSERT ON invoice_items
WHEN NEW.quantity < 1
  OR NEW.quantity > 9999
  OR NEW.unit_price < 0
  OR NEW.unit_price > 99999999
  OR NEW.amount < 0
  OR NEW.amount > 99999999
  OR NEW.amount != NEW.quantity * NEW.unit_price
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_items_integrity_update
BEFORE UPDATE ON invoice_items
WHEN NEW.quantity < 1
  OR NEW.quantity > 9999
  OR NEW.unit_price < 0
  OR NEW.unit_price > 99999999
  OR NEW.amount < 0
  OR NEW.amount > 99999999
  OR NEW.amount != NEW.quantity * NEW.unit_price
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_print_jobs_integrity_insert
BEFORE INSERT ON print_jobs
WHEN NEW.status NOT IN ('pending', 'printing', 'printed', 'failed')
  OR NEW.attempt_count < 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_integrity_check_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_print_jobs_integrity_update
BEFORE UPDATE ON print_jobs
WHEN NEW.status NOT IN ('pending', 'printing', 'printed', 'failed')
  OR NEW.attempt_count < 0
BEGIN
  SELECT RAISE(ABORT, 'print_jobs_integrity_check_failed');
END;
