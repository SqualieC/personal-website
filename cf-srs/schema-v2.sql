-- Migration v2: Replace sync_keys with proper email+password auth

DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS sync_keys;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT    DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cards (
  user_id     INTEGER NOT NULL,
  pool        TEXT    NOT NULL,
  korean      TEXT    NOT NULL,
  english     TEXT    NOT NULL DEFAULT '',
  interval    INTEGER NOT NULL DEFAULT 1,
  ease_factor REAL    NOT NULL DEFAULT 2.5,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT    NOT NULL,
  PRIMARY KEY (user_id, pool, korean),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
