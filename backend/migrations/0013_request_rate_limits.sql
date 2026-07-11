CREATE TABLE IF NOT EXISTS request_rate_limits (
  scope TEXT NOT NULL,
  identifier TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, identifier)
);

CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated_at
ON request_rate_limits(updated_at);
