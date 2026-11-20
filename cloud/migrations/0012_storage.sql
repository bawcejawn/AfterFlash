-- Rememberoll storage (Cloudflare R2): a paid amount of space for a set time, per account.
ALTER TABLE accounts ADD COLUMN storage_gb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN storage_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN storage_bytes INTEGER NOT NULL DEFAULT 0;
-- Where an event saves NEW files: '' = the host's Google Drive, 'r2' = Rememberoll storage.
ALTER TABLE events ADD COLUMN store TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS storage_purchases (
  session TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  gb INTEGER NOT NULL,
  years INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created INTEGER NOT NULL
);
