-- Scaling: an event's guests, photos and notes can live in an extra database (a "shard"),
-- and the nightly cleanup marks albums whose photo index it has cleared.
ALTER TABLE events ADD COLUMN shard TEXT DEFAULT '';   -- '' = this database; SHARD_1… = an extra one
ALTER TABLE events ADD COLUMN purged INTEGER DEFAULT 0; -- when the nightly cleanup cleared its photo index
CREATE INDEX events_shard ON events(shard);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX rate_exp ON rate(exp);
CREATE INDEX oauth_state_exp ON oauth_state(exp);
