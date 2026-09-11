CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('http', 'stdio', 'sse')),
    endpoint TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('none', 'api_key', 'oauth')),
    status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'dead')),
    is_shared BOOLEAN NOT NULL DEFAULT true,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mcp_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    input_schema JSONB NOT NULL DEFAULT '{}',
    permission_level TEXT NOT NULL CHECK (permission_level IN ('read', 'write', 'destructive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (mcp_server_id, name)
);

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived')),
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_tools_server_id ON mcp_tools(mcp_server_id);
CREATE INDEX idx_agents_status ON agents(status);
