-- Migration v4: Skill Tracker tables
-- Run with:
--   wrangler d1 execute korean-srs-db --remote --file cf-srs/schema-v4.sql

CREATE TABLE IF NOT EXISTS st_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL,
  axis_x     REAL    NOT NULL DEFAULT 0,
  axis_y     REAL    NOT NULL DEFAULT 1,
  axis_z     REAL    NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS st_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  category_id      INTEGER NOT NULL REFERENCES st_categories(id),
  started_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,
  duration_seconds INTEGER
);
