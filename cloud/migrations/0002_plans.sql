-- Time-limited admin keys: 1 month, 1 year or lifetime. Storage is unaffected (it's the host's Drive).
ALTER TABLE accounts ADD COLUMN plan TEXT DEFAULT 'lifetime';
ALTER TABLE accounts ADD COLUMN expires INTEGER DEFAULT 0;   -- 0 = never
CREATE TABLE purchases (
  session TEXT PRIMARY KEY,           -- Stripe Checkout Session id (each counts once)
  account TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX purchases_account ON purchases(account);
