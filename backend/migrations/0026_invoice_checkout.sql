ALTER TABLE invoices ADD COLUMN subtotal_amount INTEGER;
ALTER TABLE invoices ADD COLUMN discount_type TEXT;
ALTER TABLE invoices ADD COLUMN discount_value INTEGER;
ALTER TABLE invoices ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN received_amount INTEGER;
ALTER TABLE invoices ADD COLUMN change_amount INTEGER;

CREATE TRIGGER trg_invoices_checkout_integrity_insert
BEFORE INSERT ON invoices
WHEN (NEW.subtotal_amount IS NOT NULL AND (NEW.subtotal_amount < NEW.total_amount OR NEW.subtotal_amount > 99999999))
  OR NEW.discount_amount < 0
  OR NEW.discount_amount > 99999999
  OR (NEW.subtotal_amount IS NOT NULL AND NEW.discount_amount != NEW.subtotal_amount - NEW.total_amount)
  OR (NEW.discount_type IS NOT NULL AND NEW.discount_type NOT IN ('amount', 'percentage'))
  OR (NEW.received_amount IS NOT NULL AND NEW.received_amount < NEW.total_amount)
  OR (NEW.change_amount IS NOT NULL AND NEW.received_amount IS NOT NULL AND NEW.change_amount != NEW.received_amount - NEW.total_amount)
BEGIN
  SELECT RAISE(ABORT, 'invoices_checkout_integrity_check_failed');
END;

CREATE TRIGGER trg_invoices_checkout_integrity_update
BEFORE UPDATE ON invoices
WHEN (NEW.subtotal_amount IS NOT NULL AND (NEW.subtotal_amount < NEW.total_amount OR NEW.subtotal_amount > 99999999))
  OR NEW.discount_amount < 0
  OR NEW.discount_amount > 99999999
  OR (NEW.subtotal_amount IS NOT NULL AND NEW.discount_amount != NEW.subtotal_amount - NEW.total_amount)
  OR (NEW.discount_type IS NOT NULL AND NEW.discount_type NOT IN ('amount', 'percentage'))
  OR (NEW.received_amount IS NOT NULL AND NEW.received_amount < NEW.total_amount)
  OR (NEW.change_amount IS NOT NULL AND NEW.received_amount IS NOT NULL AND NEW.change_amount != NEW.received_amount - NEW.total_amount)
BEGIN
  SELECT RAISE(ABORT, 'invoices_checkout_integrity_check_failed');
END;
