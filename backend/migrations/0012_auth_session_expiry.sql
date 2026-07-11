ALTER TABLE auth_sessions ADD COLUMN expires_at TEXT;
ALTER TABLE auth_sessions ADD COLUMN revoked_at TEXT;

UPDATE auth_sessions
SET expires_at = datetime(created_at, '+30 days')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
ON auth_sessions(user_id, revoked_at, expires_at);
