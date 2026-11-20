-- Prints and photo books: one row per order. Paid through Stripe Checkout, fulfilled by the owner by hand.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,            -- 'prints' or 'book'
  items TEXT NOT NULL,           -- JSON array of media ids
  copies INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,       -- cents
  status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, sent, cancelled
  session TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  ship TEXT NOT NULL DEFAULT '',  -- JSON shipping address from Stripe
  note TEXT NOT NULL DEFAULT '',  -- tracking number or owner note
  created INTEGER NOT NULL,
  paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_event ON orders (event, created);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created);
