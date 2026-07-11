ALTER TABLE devices ADD COLUMN token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_token_hash
ON devices(token_hash);
