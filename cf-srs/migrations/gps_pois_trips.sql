CREATE TABLE IF NOT EXISTS gps_pois (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_gps_pois_user ON gps_pois(user_id);

CREATE TABLE IF NOT EXISTS gps_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES gps_devices(id),
  user_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  start_lat REAL,
  start_lon REAL,
  end_lat REAL,
  end_lon REAL,
  distance_meters REAL DEFAULT 0,
  avg_speed_mph REAL DEFAULT 0,
  max_speed_mph REAL DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  point_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_gps_trips_device ON gps_trips(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_trips_user   ON gps_trips(user_id,   started_at DESC);

ALTER TABLE gps_devices ADD COLUMN trip_state      TEXT    DEFAULT 'idle';
ALTER TABLE gps_devices ADD COLUMN current_trip_id INTEGER;
ALTER TABLE gps_devices ADD COLUMN trip_anchor_lat  REAL;
ALTER TABLE gps_devices ADD COLUMN trip_anchor_lon  REAL;
ALTER TABLE gps_devices ADD COLUMN trip_anchor_time INTEGER;
ALTER TABLE gps_devices ADD COLUMN trip_last_lat    REAL;
ALTER TABLE gps_devices ADD COLUMN trip_last_lon    REAL;
ALTER TABLE gps_devices ADD COLUMN trip_last_time   INTEGER;
ALTER TABLE gps_devices ADD COLUMN trip_distance    REAL    DEFAULT 0;
ALTER TABLE gps_devices ADD COLUMN trip_max_speed   REAL    DEFAULT 0;
ALTER TABLE gps_devices ADD COLUMN trip_point_count INTEGER DEFAULT 0;
