-- The real review queue: one row per Publish attempt, tied 1:1 to a durably
-- paused LangGraph thread (see backend/app/services/publish_graph.py). This
-- table is the queryable index ("what's pending, who does it belong to");
-- the actual pause/resume mechanics live in LangGraph's own checkpoint
-- tables, addressed by thread_id. marketplace_listings (separate table)
-- now only ever holds rows that have already been approved.
CREATE TABLE IF NOT EXISTS publish_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id),
    thread_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    tools JSONB NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL,
    governance_grade TEXT NOT NULL,
    publisher_org TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    temperature NUMERIC(3, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
    review_notes TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_publish_reviews_status ON publish_reviews(status);
CREATE INDEX IF NOT EXISTS idx_publish_reviews_agent_id ON publish_reviews(agent_id);

-- No owner_id-based RLS here by design — admins reviewing must see every
-- tenant's submissions; this is the same deliberate cross-tenant exception
-- as marketplace_listings.
