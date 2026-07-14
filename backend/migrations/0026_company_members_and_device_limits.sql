ALTER TABLE companies ADD COLUMN max_bound_devices INTEGER NOT NULL DEFAULT 1;

UPDATE companies
SET max_bound_devices = MAX(
  1,
  (
    SELECT COUNT(*)
    FROM devices d
    WHERE d.company_id = companies.id
      AND d.installation_id IS NOT NULL
  )
);

ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER trg_companies_device_limit_integrity_insert
BEFORE INSERT ON companies
WHEN NEW.max_bound_devices < 1
BEGIN
  SELECT RAISE(ABORT, 'companies_device_limit_check_failed');
END;

CREATE TRIGGER trg_companies_device_limit_integrity_update
BEFORE UPDATE ON companies
WHEN NEW.max_bound_devices < 1
BEGIN
  SELECT RAISE(ABORT, 'companies_device_limit_check_failed');
END;

CREATE TRIGGER trg_users_active_integrity_insert
BEFORE INSERT ON users
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'users_active_check_failed');
END;

CREATE TRIGGER trg_users_active_integrity_update
BEFORE UPDATE ON users
WHEN NEW.is_active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'users_active_check_failed');
END;

CREATE INDEX idx_users_company_role_active
ON users(company_id, role, is_active, id);
