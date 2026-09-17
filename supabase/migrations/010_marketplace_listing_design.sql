-- Enough of the agent's design to reconstruct a working copy for an
-- installer: system prompt + model choice, plus a display-only org label
-- derived from the publisher's email domain (never their identity).
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT 'gpt-4o-mini';
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS temperature NUMERIC(3, 2) NOT NULL DEFAULT 0;
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS publisher_org TEXT NOT NULL DEFAULT '';
