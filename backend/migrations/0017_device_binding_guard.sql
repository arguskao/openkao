ALTER TABLE companies ADD COLUMN unbind_code TEXT;

UPDATE companies
SET unbind_code = substr('00000000' || abs(random() % 100000000), -8, 8)
WHERE unbind_code IS NULL
   OR trim(unbind_code) = '';

ALTER TABLE devices ADD COLUMN installation_id TEXT;

ALTER TABLE auth_sessions ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

UPDATE auth_sessions
SET device_id = (
  SELECT d.id
  FROM devices d
  WHERE d.company_id = auth_sessions.company_id
  ORDER BY d.created_at ASC
  LIMIT 1
)
WHERE device_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_company_installation
ON devices(company_id, installation_id)
WHERE installation_id IS NOT NULL;
