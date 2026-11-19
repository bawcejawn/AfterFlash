-- RSVPs for events stored on this shard (same table as the main database).
CREATE TABLE rsvps (
  event TEXT NOT NULL,
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  party TEXT DEFAULT '[]',
  kids INTEGER DEFAULT 0,
  diet TEXT DEFAULT '',
  song TEXT DEFAULT '',
  message TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  client TEXT DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (event, id)
);
CREATE UNIQUE INDEX rsvps_client ON rsvps(event, client) WHERE client != '';
