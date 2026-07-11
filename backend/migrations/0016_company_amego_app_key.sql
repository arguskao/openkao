ALTER TABLE companies ADD COLUMN amego_app_key TEXT;

UPDATE companies
SET amego_app_key = amego_app_key_secret_name
WHERE amego_app_key IS NULL
  AND amego_app_key_secret_name IS NOT NULL
  AND amego_app_key_secret_name != ''
  AND amego_app_key_secret_name != 'AMEGO_APP_KEY_PENDING'
  AND amego_app_key_secret_name NOT LIKE 'AMEGO_APP_KEY_%';
