CREATE TABLE IF NOT EXISTS gps_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  device_key TEXT NOT NULL UNIQUE,
  last_seen INTEGER,
  last_lat REAL,
  last_lon REAL,
  battery REAL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS gps_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES gps_devices(id),
  user_id INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  altitude REAL,
  speed REAL,
  accuracy REAL,
  battery REAL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_gps_pos_device_time ON gps_positions(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gps_pos_user_time ON gps_positions(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gps_devices_user ON gps_devices(user_id);
