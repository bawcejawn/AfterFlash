-- Partner tiers (owner → tier 1 → tier 2 → tier 3), team overrides, invite links and payout requests.
ALTER TABLE ref_codes ADD COLUMN parent TEXT DEFAULT '';     -- the code of the partner who invited them ('' = added by the owner)
ALTER TABLE ref_codes ADD COLUMN tier INTEGER DEFAULT 1;
ALTER TABLE ref_codes ADD COLUMN agreed INTEGER DEFAULT 0;   -- when they accepted the partner agreement
CREATE INDEX ref_codes_parent ON ref_codes(parent);

-- One sale can now pay several partners (the seller, plus team overrides), so the
-- uniqueness moves from (session) to (session, code).
CREATE TABLE commissions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,                  -- who earns this row
  session TEXT NOT NULL,
  customer TEXT DEFAULT '',
  plan TEXT DEFAULT '',
  paid INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  method TEXT DEFAULT 'card',
  kind TEXT NOT NULL DEFAULT 'sale',   -- sale | override
  seller TEXT DEFAULT '',              -- the code the buyer used
  UNIQUE (session, code)
);
INSERT INTO commissions_new (id, code, session, customer, plan, paid, amount, created, status, method, kind, seller)
  SELECT id, code, session, customer, plan, paid, amount, created, status, method, 'sale', code FROM commissions;
DROP TABLE commissions;
ALTER TABLE commissions_new RENAME TO commissions;
CREATE INDEX commissions_code ON commissions(code);
CREATE INDEX commissions_session ON commissions(session);

-- Single-use links a partner sends to someone who wants to join their team.
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL,                  -- the inviting partner's code
  created INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  used INTEGER DEFAULT 0
);
CREATE INDEX invites_code ON invites(code);

-- A partner asks to be paid; the owner pays them and marks it done.
CREATE TABLE payout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  handle TEXT NOT NULL,                -- their Venmo/PayPal/Zelle/Cash App name, email or phone
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | declined
  done INTEGER DEFAULT 0,
  note TEXT DEFAULT ''
);
CREATE INDEX payout_requests_code ON payout_requests(code);
