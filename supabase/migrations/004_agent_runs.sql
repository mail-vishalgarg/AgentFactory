CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    trigger TEXT NOT NULL DEFAULT 'Playground' CHECK (trigger IN ('Playground', 'Schedule', 'API')),
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'approval')),
    latency_ms INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT '',
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_ran_at_idx ON agent_runs(ran_at DESC);
