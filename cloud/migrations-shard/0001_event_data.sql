-- An extra database (shard) holding events' guests, photos and voice/guestbook notes.
-- Same tables as the main database; the main database's events table says which shard each event uses.

CREATE TABLE guests (
  event TEXT NOT NULL,
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  shots INTEGER DEFAULT 0,
  uploads INTEGER DEFAULT 0,
  created INTEGER NOT NULL,
  reports INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  PRIMARY KEY (event, id)
);

CREATE TABLE media (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,            -- Google Drive file id
  thumb TEXT DEFAULT '',
  guest TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha TEXT DEFAULT '',
  w INTEGER DEFAULT 0, h INTEGER DEFAULT 0, dur INTEGER DEFAULT 0,
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  reports INTEGER DEFAULT 0,
  client TEXT NOT NULL,
  flags TEXT DEFAULT '',
  fav INTEGER DEFAULT 0
);
CREATE INDEX media_event ON media(event);
CREATE UNIQUE INDEX media_client ON media(event, guest, client);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  guest TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT DEFAULT '',
  audio TEXT DEFAULT '',
  created INTEGER NOT NULL,
  status TEXT NOT NULL,
  client TEXT DEFAULT '',
  dur INTEGER DEFAULT 0
);
CREATE INDEX notes_event ON notes(event);
