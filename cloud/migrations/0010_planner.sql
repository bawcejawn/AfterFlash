-- Planner tools: a business name and website shown as "Planned by …" on the account's events.
ALTER TABLE accounts ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN brand TEXT NOT NULL DEFAULT '';
