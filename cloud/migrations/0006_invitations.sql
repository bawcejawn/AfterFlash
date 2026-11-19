-- Invitations + RSVPs. Each RSVP lives next to the event's guests (main DB or its shard).
ALTER TABLE events ADD COLUMN rsvp_folder TEXT DEFAULT '';  -- Drive folder for RSVP selfies (private)
ALTER TABLE events ADD COLUMN cover TEXT DEFAULT '';        -- JSON {id, v, mime}: the invitation's cover photo

CREATE TABLE rsvps (
  event TEXT NOT NULL,
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,           -- SHA-256 of the guest's private edit token
  name TEXT NOT NULL,
  status TEXT NOT NULL,               -- yes | maybe | no
  party TEXT DEFAULT '[]',            -- JSON [{n: name, m: meal}], first entry is the person replying
  kids INTEGER DEFAULT 0,
  diet TEXT DEFAULT '',
  song TEXT DEFAULT '',
  message TEXT DEFAULT '',
  photo TEXT DEFAULT '',              -- Drive file id of the optional selfie (never shared)
  client TEXT DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (event, id)
);
CREATE UNIQUE INDEX rsvps_client ON rsvps(event, client) WHERE client != '';
