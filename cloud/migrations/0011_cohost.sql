-- One free co-host link per event (a second host link that can't remove the main host).
ALTER TABLE events ADD COLUMN cohost_hash TEXT NOT NULL DEFAULT '';
