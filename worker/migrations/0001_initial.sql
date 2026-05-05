-- Cloudflare D1 schema for private Claw Mail Worker.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  prefix TEXT,
  type TEXT NOT NULL DEFAULT 'sub',
  status TEXT NOT NULL DEFAULT 'active',
  display_name TEXT,
  comm_level INTEGER,
  ext_receive_type INTEGER,
  ext_send_type INTEGER,
  comm_settings_json TEXT,
  aggregate_enabled INTEGER NOT NULL DEFAULT 1,
  openclaw_status TEXT,
  auth_url TEXT,
  raw_json TEXT,
  created_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_status_aggregate
  ON mailboxes(status, aggregate_enabled);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox_email TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  subject TEXT,
  from_json TEXT,
  to_json TEXT,
  cc_json TEXT,
  preview TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  date TEXT,
  cached_text TEXT,
  cached_html TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(mailbox_email, provider_id),
  FOREIGN KEY(mailbox_email) REFERENCES mailboxes(email) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_scope_folder_date
  ON messages(mailbox_email, folder_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_messages_folder_date
  ON messages(folder_id, date DESC);

CREATE TABLE IF NOT EXISTS refresh_state (
  mailbox_email TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  cursor TEXT,
  newest_message_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(mailbox_email, folder_id),
  FOREIGN KEY(mailbox_email) REFERENCES mailboxes(email) ON DELETE CASCADE
);
