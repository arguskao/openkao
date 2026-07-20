DROP TRIGGER IF EXISTS trg_invoice_items_integrity_insert;
DROP TRIGGER IF EXISTS trg_invoice_items_integrity_update;

CREATE TRIGGER trg_invoice_items_integrity_insert
BEFORE INSERT ON invoice_items
WHEN NEW.quantity < 1
  OR NEW.quantity > 9999
  OR NEW.unit_price > 99999999
  OR NEW.unit_price < -99999999
  OR NEW.amount > 99999999
  OR NEW.amount < -99999999
  OR NEW.amount != NEW.quantity * NEW.unit_price
  OR (NEW.name = '整單折扣' AND (NEW.quantity != 1 OR NEW.unit_price >= 0))
  OR (NEW.name != '整單折扣' AND NEW.unit_price < 0)
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_integrity_check_failed');
END;

CREATE TRIGGER trg_invoice_items_integrity_update
BEFORE UPDATE ON invoice_items
WHEN NEW.quantity < 1
  OR NEW.quantity > 9999
  OR NEW.unit_price > 99999999
  OR NEW.unit_price < -99999999
  OR NEW.amount > 99999999
  OR NEW.amount < -99999999
  OR NEW.amount != NEW.quantity * NEW.unit_price
  OR (NEW.name = '整單折扣' AND (NEW.quantity != 1 OR NEW.unit_price >= 0))
  OR (NEW.name != '整單折扣' AND NEW.unit_price < 0)
BEGIN
  SELECT RAISE(ABORT, 'invoice_items_integrity_check_failed');
END;
