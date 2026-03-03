-- Migration v3: Add difficulty column for FSRS-5
-- ease_factor column is repurposed to store stability (float)
-- Run with: wrangler d1 execute DB --remote --command "ALTER TABLE cards ADD COLUMN difficulty REAL NOT NULL DEFAULT 5.0"

ALTER TABLE cards ADD COLUMN difficulty REAL NOT NULL DEFAULT 5.0;
