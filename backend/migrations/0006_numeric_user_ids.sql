PRAGMA foreign_keys = OFF;

CREATE TABLE user_id_map (
  old_id TEXT PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
);

INSERT INTO user_id_map (old_id, new_id)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)
FROM users;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  phone TEXT
);

INSERT INTO users_new (id, email, password_hash, name, created_at, updated_at, company_id, phone)
SELECT
  m.new_id,
  u.email,
  u.password_hash,
  u.name,
  u.created_at,
  u.updated_at,
  u.company_id,
  u.phone
FROM users u
JOIN user_id_map m ON m.old_id = u.id
ORDER BY m.new_id;

CREATE TABLE auth_sessions_new (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO auth_sessions_new (token, user_id, company_id, created_at, last_seen_at)
SELECT
  s.token,
  m.new_id,
  s.company_id,
  s.created_at,
  s.last_seen_at
FROM auth_sessions s
JOIN user_id_map m ON m.old_id = s.user_id;

DROP TABLE auth_sessions;
DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
ALTER TABLE auth_sessions_new RENAME TO auth_sessions;

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, created_at);

DROP TABLE user_id_map;

PRAGMA foreign_keys = ON;
