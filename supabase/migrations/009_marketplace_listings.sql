-- A listing carries only the agent's design (name, description, sanitized
-- tool list, score) -- never credentials, never the internal mcp_server_id,
-- never anything else specific to the publishing owner's workspace.
CREATE TABLE IF NOT EXISTS marketplace_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    publisher_owner_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    tools JSONB NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL,
    governance_grade TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_notes TEXT,
    install_count INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_agent_id ON marketplace_listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status ON marketplace_listings(status);
