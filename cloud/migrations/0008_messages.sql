-- Automatic messages: guest emails (optional, from the RSVP form or added by the host),
-- an unsubscribe token per address, and a log of what was sent.
ALTER TABLE rsvps ADD COLUMN email TEXT DEFAULT '';
CREATE TABLE invitees (
  event TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT DEFAULT '',
  token TEXT NOT NULL,        -- random; the unsubscribe link carries it
  invited INTEGER DEFAULT 0,  -- when the invitation email went out (0 = not yet)
  optout INTEGER DEFAULT 0,
  added INTEGER NOT NULL,
  PRIMARY KEY (event, email)
);
CREATE TABLE msg_log (
  event TEXT NOT NULL,
  kind TEXT NOT NULL,         -- invite | reminder | camera | photos | thanks
  at INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  auto INTEGER DEFAULT 0
);
CREATE INDEX msg_log_event ON msg_log(event, at);
