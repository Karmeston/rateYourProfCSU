ALTER TABLE moderation_actions ADD COLUMN actor TEXT NOT NULL DEFAULT 'cli' CHECK (actor IN ('cli','admin'));
ALTER TABLE moderation_actions ADD COLUMN target_revision INTEGER;
CREATE INDEX idx_moderation_recent ON moderation_actions(created_at DESC,id);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_admin_session_expiry ON admin_sessions(expires_at);

-- Short-lived receipts make duplicate beacons idempotent without storing browsing histories.
CREATE TABLE traffic_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  token TEXT NOT NULL
) STRICT;
CREATE INDEX idx_traffic_receipt_day ON traffic_receipts(day);
CREATE TABLE traffic_daily (
  day TEXT NOT NULL,
  page TEXT NOT NULL CHECK (page IN ('catalog','course','teacher_catalog','teacher','guide')),
  target_id INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL CHECK (views > 0),
  PRIMARY KEY(day,page,target_id)
) STRICT;
