-- Isolation retrofit: attach every user-owned row to a real user.
-- mcp_servers stays a SHARED catalog (is_shared already models this) --
-- owner_id here is for attribution/delete-permission only, not read-scoping.
-- connections and agents become strictly private per owner (Rule 2).
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);

-- Backfill: every row created before auth existed belonged to no one in
-- particular, so it becomes the admin's.
UPDATE mcp_servers SET owner_id = (SELECT id FROM users WHERE email = 'admin@capstone.com') WHERE owner_id IS NULL;
UPDATE connections SET owner_id = (SELECT id FROM users WHERE email = 'admin@capstone.com') WHERE owner_id IS NULL;
UPDATE agents SET owner_id = (SELECT id FROM users WHERE email = 'admin@capstone.com') WHERE owner_id IS NULL;

ALTER TABLE mcp_servers ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE connections ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE agents ALTER COLUMN owner_id SET NOT NULL;

-- A connection's credential is private per user: the same server_name can
-- now be connected independently by every owner.
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_server_name_key;
ALTER TABLE connections ADD CONSTRAINT connections_owner_server_unique UNIQUE (owner_id, server_name);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_id ON mcp_servers(owner_id);
CREATE INDEX IF NOT EXISTS idx_connections_owner_id ON connections(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id);
