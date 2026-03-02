CREATE TABLE IF NOT EXISTS sync_keys (
  sync_key TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  sync_key    TEXT    NOT NULL,
  pool        TEXT    NOT NULL,
  korean      TEXT    NOT NULL,
  english     TEXT    NOT NULL DEFAULT '',
  interval    INTEGER NOT NULL DEFAULT 1,
  ease_factor REAL    NOT NULL DEFAULT 2.5,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT    NOT NULL,
  PRIMARY KEY (sync_key, pool, korean),
  FOREIGN KEY (sync_key) REFERENCES sync_keys(sync_key) ON DELETE CASCADE
);
