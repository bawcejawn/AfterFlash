-- Afterflash Cloud: accounts (hosts who bought a key), their events and everything guests add.
-- Photos themselves live in each host's own Google Drive; this database only indexes them.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  key_hash TEXT UNIQUE,
  kind TEXT NOT NULL,                 -- paid | comp | owner
  status TEXT NOT NULL DEFAULT 'active',
  email TEXT DEFAULT '',
  created INTEGER NOT NULL,
  stripe_session TEXT UNIQUE,
  claim_until INTEGER DEFAULT 0,      -- the purchase page may re-show a key until then
  google_sub TEXT,
  google_email TEXT DEFAULT '',
  refresh_enc TEXT DEFAULT '',        -- Google refresh token, AES-GCM encrypted with DATA_KEY
  root_folder TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
CREATE INDEX accounts_google ON accounts(google_sub);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  folder TEXT NOT NULL,
  previews_folder TEXT DEFAULT '',
  voice_folder TEXT DEFAULT '',
  host_hash TEXT NOT NULL,
  settings TEXT NOT NULL,
  pin_hash TEXT DEFAULT '',
  deleted INTEGER DEFAULT 0,
  v TEXT DEFAULT '',
  ek_enc TEXT DEFAULT '',             -- private-storage event key, encrypted with DATA_KEY
  logo TEXT DEFAULT ''                -- JSON {id, v, mime}
);
CREATE INDEX events_account ON events(account);

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

CREATE TABLE rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE oauth_state (state TEXT PRIMARY KEY, account TEXT, purpose TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE problems (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT, t INTEGER, w TEXT, e TEXT, m TEXT);
