ALTER TABLE auth_sessions ADD COLUMN token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash
ON auth_sessions(token_hash)
WHERE token_hash IS NOT NULL;
