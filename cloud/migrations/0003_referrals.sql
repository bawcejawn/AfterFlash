-- Referral partners: codes that give buyers a discount and earn the partner a commission.
CREATE TABLE ref_codes (
  code TEXT PRIMARY KEY,               -- e.g. MIKE10 (upper-case letters and digits)
  account TEXT DEFAULT '',             -- the partner's own admin-key account, if they have one
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  discount INTEGER NOT NULL DEFAULT 10,   -- % off for the buyer
  commission INTEGER NOT NULL DEFAULT 20, -- % of what the buyer paid
  active INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  note TEXT DEFAULT ''
);
CREATE INDEX ref_codes_account ON ref_codes(account);

-- One row per sale made with a code. status: ok | void (e.g. refunded).
CREATE TABLE commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  session TEXT UNIQUE,                 -- Stripe Checkout Session, or cash:<id>
  customer TEXT DEFAULT '',
  plan TEXT DEFAULT '',
  paid INTEGER NOT NULL,               -- cents the buyer paid
  amount INTEGER NOT NULL,             -- cents owed to the partner
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  method TEXT DEFAULT 'card'
);
CREATE INDEX commissions_code ON commissions(code);

-- Money the owner has paid out to partners (recorded by hand).
CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created INTEGER NOT NULL,
  method TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
CREATE INDEX payouts_code ON payouts(code);

ALTER TABLE accounts ADD COLUMN ref TEXT DEFAULT '';           -- the code this customer bought with
ALTER TABLE accounts ADD COLUMN max_events INTEGER DEFAULT 0;   -- 0 = unlimited; the one-event plan allows 1 per purchase
ALTER TABLE purchases ADD COLUMN ref TEXT DEFAULT '';
ALTER TABLE purchases ADD COLUMN method TEXT DEFAULT 'card';    -- card | cash
