-- ==============================================================================
-- PERSONAL MCP REGISTRY SCHEMA & SEED DATA (SUPABASE / POSTGRESQL)
-- Run this in your Supabase SQL Editor or local PostgreSQL database
-- ==============================================================================

-- 1. Create mcp_servers Table
CREATE TABLE IF NOT EXISTS public.mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Dev Tools',
    package_name TEXT,
    transport TEXT NOT NULL DEFAULT 'stdio',
    command TEXT,
    command_args JSONB DEFAULT '[]'::jsonb,
    env_vars JSONB DEFAULT '{}'::jsonb,
    url TEXT,
    auth_type TEXT NOT NULL DEFAULT 'api_key',
    token_guide TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    connected BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create mcp_tools Table
CREATE TABLE IF NOT EXISTS public.mcp_tools (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES public.mcp_servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'destructive')),
    input_schema JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_mcp_servers_category ON public.mcp_servers(category);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_server_id ON public.mcp_tools(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_risk ON public.mcp_tools(risk_level);

-- 4. Enable Row Level Security (RLS) & Policies
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tools ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access to mcp_servers') THEN
        CREATE POLICY "Allow public read access to mcp_servers" ON public.mcp_servers FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public write access to mcp_servers') THEN
        CREATE POLICY "Allow public write access to mcp_servers" ON public.mcp_servers FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access to mcp_tools') THEN
        CREATE POLICY "Allow public read access to mcp_tools" ON public.mcp_tools FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public write access to mcp_tools') THEN
        CREATE POLICY "Allow public write access to mcp_tools" ON public.mcp_tools FOR ALL USING (true);
    END IF;
END $$;

-- 5. Seed 15 Token-Required MCP Servers into mcp_servers
INSERT INTO public.mcp_servers (id, name, display_name, description, category, package_name, transport, command, command_args, env_vars, url, auth_type, token_guide, status, connected)
VALUES
('srv-github', 'github', 'GitHub MCP', 'Official GitHub MCP Server: repositories, pull requests, issues, workflows, commits, branches and code search.', 'Dev Tools', '@modelcontextprotocol/server-github', 'stdio', 'npx -y @modelcontextprotocol/server-github', '[]'::jsonb, '{"GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token-here>"}'::jsonb, 'https://api.github.com', 'api_key', 'Get Personal Access Token: https://github.com/settings/tokens/new (Select repo & workflow scope)', 'ok', true),
('srv-brave-search', 'brave_search', 'Brave Web Search MCP', 'Official Brave Search MCP Server: real-time internet web search, news search, and local business lookup.', 'AI & Web', '@modelcontextprotocol/server-brave-search', 'stdio', 'npx -y @modelcontextprotocol/server-brave-search', '[]'::jsonb, '{"BRAVE_API_KEY": "<brave-api-key>"}'::jsonb, 'https://api.search.brave.com', 'api_key', 'Get Free API Key: https://api.search.brave.com/app/keys (2,000 free queries/month)', 'ok', true),
('srv-groq', 'groq', 'Groq AI Inference MCP', 'Ultra-fast LPU inference engine for Llama 3, Mixtral, and Whisper audio transcription.', 'AI & Web', 'groq-mcp-server', 'stdio', 'npx -y groq-mcp-server', '[]'::jsonb, '{"GROQ_API_KEY": "<groq-api-key>"}'::jsonb, 'https://api.groq.com/openai/v1', 'api_key', 'Get Groq API Key: https://console.groq.com/keys (Instant free tier access)', 'ok', true),
('srv-openai', 'openai', 'OpenAI ChatGPT MCP', 'Official OpenAI API MCP: GPT-4o chat completions, text embeddings, and DALL-E image generation.', 'AI & Web', '@modelcontextprotocol/server-openai', 'stdio', 'npx -y @modelcontextprotocol/server-openai', '[]'::jsonb, '{"OPENAI_API_KEY": "<openai-api-key>"}'::jsonb, 'https://api.openai.com/v1', 'api_key', 'Get OpenAI Secret Key: https://platform.openai.com/api-keys', 'ok', true),
('srv-tavily', 'tavily', 'Tavily AI Search MCP', 'Search engine specifically optimized for LLMs and autonomous agents with clean markdown extracts.', 'AI & Web', 'tavily-mcp', 'stdio', 'npx -y tavily-mcp', '[]'::jsonb, '{"TAVILY_API_KEY": "<tavily-api-key>"}'::jsonb, 'https://api.tavily.com', 'api_key', 'Get Tavily API Key: https://app.tavily.com/home (1,000 free searches/month)', 'ok', true),
('srv-huggingface', 'huggingface', 'Hugging Face MCP', 'Official Hugging Face MCP Server: search machine learning models, explore datasets, inspect spaces, and run open-source AI inference.', 'AI & Web', 'mcp-server-huggingface', 'stdio', 'uvx mcp-server-huggingface', '[]'::jsonb, '{"HF_TOKEN": "<hf-user-token>"}'::jsonb, 'https://huggingface.co/api', 'api_key', 'Get Hugging Face User Access Token: https://huggingface.co/settings/tokens/new?tokenType=read', 'ok', true),
('srv-postgres', 'postgres', 'PostgreSQL / Supabase MCP', 'Official PostgreSQL MCP Server: database inspection, query execution, indexing analysis, and schema migrations.', 'Database', '@modelcontextprotocol/server-postgres', 'stdio', 'npx -y @modelcontextprotocol/server-postgres', '["postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres"]'::jsonb, '{"POSTGRES_CONNECTION_URL": "postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres"}'::jsonb, 'https://supabase.com/dashboard', 'api_key', 'Get Database Connection URI: https://supabase.com/dashboard/project/_/settings/database', 'ok', true),
('srv-sqlite', 'sqlite', 'Turso Cloud SQLite MCP', 'Serverless SQLite with libSQL: edge replication, distributed transactions, and schema inspection.', 'Database', '@turso/mcp-server-sqlite', 'stdio', 'npx -y @turso/mcp-server-sqlite', '["--url", "libsql://[your-db].turso.io"]'::jsonb, '{"TURSO_AUTH_TOKEN": "<turso-auth-token>"}'::jsonb, 'https://turso.tech/app', 'api_key', 'Get Turso SQLite Auth Token: https://turso.tech/app (Create database & token)', 'ok', true),
('srv-airtable', 'airtable', 'Airtable Database MCP', 'Relational database and spreadsheet MCP: inspect bases, query tables, create records, and update schemas.', 'Database', 'mcp-server-airtable', 'stdio', 'npx -y mcp-server-airtable', '[]'::jsonb, '{"AIRTABLE_PERSONAL_ACCESS_TOKEN": "<airtable-token>"}'::jsonb, 'https://api.airtable.com/v0', 'api_key', 'Create Airtable Personal Access Token: https://airtable.com/create/tokens (Add data.records scopes)', 'ok', true),
('srv-google-maps', 'google_maps', 'Google Maps Platform MCP', 'Official Google Maps MCP: geocoding, reverse lookup, place details, elevation, and directions calculation.', 'AI & Web', '@modelcontextprotocol/server-google-maps', 'stdio', 'npx -y @modelcontextprotocol/server-google-maps', '[]'::jsonb, '{"GOOGLE_MAPS_API_KEY": "<google-maps-api-key>"}'::jsonb, 'https://maps.googleapis.com', 'api_key', 'Get Google Maps API Key: https://console.cloud.google.com/google/maps-apis/credentials', 'ok', true),
('srv-slack', 'slack', 'Slack Team MCP', 'Official Slack MCP Server: send channel messages, reply to threads, upload files, and manage reactions.', 'Productivity', '@modelcontextprotocol/server-slack', 'stdio', 'npx -y @modelcontextprotocol/server-slack', '[]'::jsonb, '{"SLACK_BOT_TOKEN": "xoxb-<your-slack-bot-token>"}'::jsonb, 'https://slack.com/api', 'api_key', 'Create Slack Bot Token (xoxb): https://api.slack.com/apps (OAuth & Permissions -> Bot Token Scopes)', 'ok', true),
('srv-notion', 'notion', 'Notion Workspace MCP', 'Workspace knowledge base MCP: search docs, query databases, append page blocks, and manage tasks.', 'Productivity', 'notion-mcp-server', 'stdio', 'npx -y notion-mcp-server', '[]'::jsonb, '{"NOTION_API_KEY": "secret_<your-notion-token>"}'::jsonb, 'https://api.notion.com/v1', 'api_key', 'Create Notion Internal Integration Token: https://www.notion.so/my-integrations', 'ok', true),
('srv-linear', 'linear', 'Linear Issue Tracker MCP', 'Project management MCP: manage sprints, create and update issues, query teams, and log comments.', 'Productivity', 'linear-mcp-server', 'stdio', 'npx -y linear-mcp-server', '[]'::jsonb, '{"LINEAR_API_KEY": "lin_api_<your-linear-token>"}'::jsonb, 'https://api.linear.app/graphql', 'api_key', 'Generate Linear Personal API Key: https://linear.app/settings/api', 'ok', true),
('srv-gitlab', 'gitlab', 'GitLab DevOps MCP', 'DevOps MCP Server: manage GitLab projects, merge requests, issues, CI/CD pipelines, and source files.', 'Dev Tools', '@modelcontextprotocol/server-gitlab', 'stdio', 'npx -y @modelcontextprotocol/server-gitlab', '[]'::jsonb, '{"GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-<your-gitlab-token>"}'::jsonb, 'https://gitlab.com/api/v4', 'api_key', 'Generate GitLab Access Token: https://gitlab.com/-/user_settings/personal_access_tokens (Select api scope)', 'ok', true),
('srv-sentry', 'sentry', 'Sentry Error Tracking MCP', 'Application monitoring MCP: inspect real-time production errors, issue stacktraces, and release health.', 'Dev Tools', '@modelcontextprotocol/server-sentry', 'stdio', 'npx -y @modelcontextprotocol/server-sentry', '[]'::jsonb, '{"SENTRY_AUTH_TOKEN": "<sentry-auth-token>"}'::jsonb, 'https://sentry.io/api/0', 'api_key', 'Create Sentry User Auth Token: https://sentry.io/settings/account/api/auth-tokens/', 'ok', true)
ON CONFLICT (id) DO UPDATE SET
display_name = EXCLUDED.display_name,
description = EXCLUDED.description,
command = EXCLUDED.command,
command_args = EXCLUDED.command_args,
env_vars = EXCLUDED.env_vars,
url = EXCLUDED.url,
token_guide = EXCLUDED.token_guide;

-- 6. Seed All 44 Official GitHub Tools
INSERT INTO public.mcp_tools (id, server_id, name, description, risk_level, input_schema)
VALUES
('gh-1', 'srv-github', 'create_or_update_file', 'Create or update a single file in a GitHub repository', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "path": {"type": "string"}, "content": {"type": "string"}, "message": {"type": "string"}}}'::jsonb),
('gh-2', 'srv-github', 'get_file_contents', 'Get the contents of a file or directory in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "path": {"type": "string"}, "ref": {"type": "string"}}}'::jsonb),
('gh-3', 'srv-github', 'push_files', 'Commit and push multiple files in a single atomic commit', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "branch": {"type": "string"}, "files": {"type": "array"}}}'::jsonb),
('gh-4', 'srv-github', 'create_issue', 'Create a new issue in a GitHub repository', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "title": {"type": "string"}, "body": {"type": "string"}}}'::jsonb),
('gh-5', 'srv-github', 'list_issues', 'List issues in a repository with state and label filters', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "state": {"type": "string"}}}'::jsonb),
('gh-6', 'srv-github', 'get_issue', 'Get details of a specific issue with its comments', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "issue_number": {"type": "integer"}}}'::jsonb),
('gh-7', 'srv-github', 'update_issue', 'Update an existing issue title, body, labels, or state', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "issue_number": {"type": "integer"}}}'::jsonb),
('gh-8', 'srv-github', 'add_issue_comment', 'Add a new comment to an existing issue', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "issue_number": {"type": "integer"}, "body": {"type": "string"}}}'::jsonb),
('gh-9', 'srv-github', 'list_issue_comments', 'List all comments on a specific issue', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "issue_number": {"type": "integer"}}}'::jsonb),
('gh-10', 'srv-github', 'create_pull_request', 'Create a new pull request in a repository', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "title": {"type": "string"}, "head": {"type": "string"}, "base": {"type": "string"}}}'::jsonb),
('gh-11', 'srv-github', 'get_pull_request', 'Get details of a specific pull request', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-12', 'srv-github', 'list_pull_requests', 'List pull requests in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "state": {"type": "string"}}}'::jsonb),
('gh-13', 'srv-github', 'update_pull_request', 'Update a pull request title, body, or draft status', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-14', 'srv-github', 'merge_pull_request', 'Merge a pull request into the base branch', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-15', 'srv-github', 'get_pull_request_files', 'List all changed files in a pull request with diffs', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-16', 'srv-github', 'get_pull_request_status', 'Get the combined commit status and check runs for a PR', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-17', 'srv-github', 'create_pull_request_review', 'Create a code review for a pull request', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "pull_number": {"type": "integer"}}}'::jsonb),
('gh-18', 'srv-github', 'create_branch', 'Create a new git branch from an existing ref or commit', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "branch": {"type": "string"}}}'::jsonb),
('gh-19', 'srv-github', 'delete_branch', 'Delete a branch permanently from a repository', 'destructive', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "branch": {"type": "string"}}}'::jsonb),
('gh-20', 'srv-github', 'list_branches', 'List all branches in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-21', 'srv-github', 'get_branch', 'Get details and head commit of a specific branch', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "branch": {"type": "string"}}}'::jsonb),
('gh-22', 'srv-github', 'create_repository', 'Create a new repository for the authenticated user or organization', 'write', '{"type": "object", "properties": {"name": {"type": "string"}, "private": {"type": "boolean"}}}'::jsonb),
('gh-23', 'srv-github', 'fork_repository', 'Fork a repository to the authenticated user account', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-24', 'srv-github', 'get_repository', 'Get repository metadata, stars, forks, and settings', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-25', 'srv-github', 'search_repositories', 'Search for GitHub repositories by name, topics, or language', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('gh-26', 'srv-github', 'search_code', 'Search code across repositories using GitHub code search syntax', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('gh-27', 'srv-github', 'search_issues', 'Search for issues and PRs using GitHub search syntax', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('gh-28', 'srv-github', 'search_users', 'Search GitHub users by username, email, or full name', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('gh-29', 'srv-github', 'list_commits', 'List commits on a branch or repository path', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-30', 'srv-github', 'get_commit', 'Get detailed commit metadata, author, and file diffs', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "commit_sha": {"type": "string"}}}'::jsonb),
('gh-31', 'srv-github', 'list_tags', 'List all git tags in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-32', 'srv-github', 'get_tag', 'Get details of an annotated tag', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "tag": {"type": "string"}}}'::jsonb),
('gh-33', 'srv-github', 'create_tag', 'Create a new annotated git tag', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "tag": {"type": "string"}}}'::jsonb),
('gh-34', 'srv-github', 'list_releases', 'List releases published in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-35', 'srv-github', 'get_latest_release', 'Get the latest published release', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-36', 'srv-github', 'get_release_by_tag', 'Get release details by git tag name', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "tag": {"type": "string"}}}'::jsonb),
('gh-37', 'srv-github', 'create_release', 'Create and publish a new GitHub release', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "tag_name": {"type": "string"}}}'::jsonb),
('gh-38', 'srv-github', 'list_workflows', 'List GitHub Actions workflows in a repository', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}}}'::jsonb),
('gh-39', 'srv-github', 'get_workflow', 'Get details of a specific Actions workflow', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "workflow_id": {"type": "string"}}}'::jsonb),
('gh-40', 'srv-github', 'list_workflow_runs', 'List runs for an Actions workflow', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "workflow_id": {"type": "string"}}}'::jsonb),
('gh-41', 'srv-github', 'get_workflow_run', 'Get details of a specific workflow run', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "run_id": {"type": "integer"}}}'::jsonb),
('gh-42', 'srv-github', 'rerun_workflow', 'Re-run all jobs in a GitHub Actions workflow', 'write', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "run_id": {"type": "integer"}}}'::jsonb),
('gh-43', 'srv-github', 'cancel_workflow_run', 'Cancel a running GitHub Actions workflow run immediately', 'destructive', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "run_id": {"type": "integer"}}}'::jsonb),
('gh-44', 'srv-github', 'get_workflow_run_logs', 'Download and inspect logs from a workflow run', 'read', '{"type": "object", "properties": {"owner": {"type": "string"}, "repo": {"type": "string"}, "run_id": {"type": "integer"}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 7. Seed Tools for Remaining 14 Token-Required Servers
INSERT INTO public.mcp_tools (id, server_id, name, description, risk_level, input_schema)
VALUES
-- Brave Search (6)
('bs-1', 'srv-brave-search', 'brave_web_search', 'Execute web search query and return top results with snippets', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('bs-2', 'srv-brave-search', 'brave_local_search', 'Search local businesses, locations and addresses', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('bs-3', 'srv-brave-search', 'brave_news_search', 'Search latest news headlines and published articles', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('bs-4', 'srv-brave-search', 'brave_image_search', 'Search for relevant images and thumbnail URLs', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('bs-5', 'srv-brave-search', 'brave_video_search', 'Search for video content and descriptions', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('bs-6', 'srv-brave-search', 'brave_summarize', 'Get AI-summarized web answers for a query', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),

-- Groq AI Inference (5)
('gq-1', 'srv-groq', 'groq_chat_completion', 'Fast LLM generation with Llama 3 or Mixtral models', 'read', '{"type": "object", "properties": {"model": {"type": "string"}, "messages": {"type": "array"}}}'::jsonb),
('gq-2', 'srv-groq', 'groq_transcribe_audio', 'Transcribe audio speech to text using Whisper on Groq LPU', 'read', '{"type": "object", "properties": {"audio_url": {"type": "string"}}}'::jsonb),
('gq-3', 'srv-groq', 'groq_translate_audio', 'Translate spoken audio to English text directly', 'read', '{"type": "object", "properties": {"audio_url": {"type": "string"}}}'::jsonb),
('gq-4', 'srv-groq', 'groq_list_models', 'List active models and current rate limits on Groq Cloud', 'read', '{}'::jsonb),
('gq-5', 'srv-groq', 'groq_benchmark_speed', 'Measure tokens-per-second generation latency for a prompt', 'read', '{"type": "object", "properties": {"prompt": {"type": "string"}}}'::jsonb),

-- OpenAI ChatGPT (6)
('oa-1', 'srv-openai', 'openai_chat_completion', 'Generate completions with GPT-4o or GPT-4o-mini', 'read', '{"type": "object", "properties": {"model": {"type": "string"}, "messages": {"type": "array"}}}'::jsonb),
('oa-2', 'srv-openai', 'openai_create_embeddings', 'Generate dense vector embeddings for semantic search', 'read', '{"type": "object", "properties": {"input": {"type": "string"}}}'::jsonb),
('oa-3', 'srv-openai', 'openai_generate_image', 'Generate high-quality images using DALL-E 3', 'write', '{"type": "object", "properties": {"prompt": {"type": "string"}, "size": {"type": "string"}}}'::jsonb),
('oa-4', 'srv-openai', 'openai_text_to_speech', 'Synthesize spoken audio from text using OpenAI TTS models', 'read', '{"type": "object", "properties": {"input": {"type": "string"}, "voice": {"type": "string"}}}'::jsonb),
('oa-5', 'srv-openai', 'openai_transcribe_audio', 'Transcribe speech to text using OpenAI Whisper', 'read', '{"type": "object", "properties": {"file_url": {"type": "string"}}}'::jsonb),
('oa-6', 'srv-openai', 'openai_list_models', 'List all available OpenAI models and checkpoints', 'read', '{}'::jsonb),

-- Tavily AI Search (4)
('tv-1', 'srv-tavily', 'tavily_search', 'Search web and return AI-ready markdown content and citations', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('tv-2', 'srv-tavily', 'tavily_extract', 'Extract clean markdown article body from any URL', 'read', '{"type": "object", "properties": {"urls": {"type": "array"}}}'::jsonb),
('tv-3', 'srv-tavily', 'tavily_qna_search', 'Direct question-answering search with synthesized reply', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('tv-4', 'srv-tavily', 'tavily_get_search_context', 'Retrieve concise context string tailored for LLM RAG pipelines', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),

-- Hugging Face (8)
('hf-1', 'srv-huggingface', 'search_models', 'Search open-source AI models by task, tag or architecture', 'read', '{"type": "object", "properties": {"query": {"type": "string"}, "task": {"type": "string"}}}'::jsonb),
('hf-2', 'srv-huggingface', 'get_model_info', 'Get model architecture, parameters, license, and download statistics', 'read', '{"type": "object", "properties": {"model_id": {"type": "string"}}}'::jsonb),
('hf-3', 'srv-huggingface', 'search_datasets', 'Search machine learning datasets for NLP, audio and computer vision', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('hf-4', 'srv-huggingface', 'search_spaces', 'Search community interactive Gradio and Streamlit demo apps', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('hf-5', 'srv-huggingface', 'run_inference', 'Run serverless inference on supported open-source models', 'write', '{"type": "object", "properties": {"model_id": {"type": "string"}, "inputs": {"type": "string"}}}'::jsonb),
('hf-6', 'srv-huggingface', 'get_dataset_viewer', 'Inspect the first rows and columnar schema of a dataset', 'read', '{"type": "object", "properties": {"dataset_id": {"type": "string"}}}'::jsonb),
('hf-7', 'srv-huggingface', 'list_tags', 'List available model pipelines, libraries and language tags', 'read', '{}'::jsonb),
('hf-8', 'srv-huggingface', 'check_endpoint_status', 'Check warm/cold status of a Hugging Face Inference endpoint', 'read', '{"type": "object", "properties": {"endpoint_name": {"type": "string"}}}'::jsonb),

-- PostgreSQL / Supabase (10)
('pg-1', 'srv-postgres', 'postgres_query', 'Execute read-only SQL SELECT queries with parameterized inputs', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('pg-2', 'srv-postgres', 'postgres_execute', 'Execute SQL INSERT, UPDATE, or ALTER statements', 'write', '{"type": "object", "properties": {"sql": {"type": "string"}}}'::jsonb),
('pg-3', 'srv-postgres', 'postgres_list_tables', 'List all tables, views and schemas in PostgreSQL database', 'read', '{}'::jsonb),
('pg-4', 'srv-postgres', 'postgres_describe_table', 'Inspect table columns, data types, constraints and nullability', 'read', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('pg-5', 'srv-postgres', 'postgres_list_indexes', 'Inspect database indexes and primary keys for query optimization', 'read', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('pg-6', 'srv-postgres', 'postgres_create_table', 'Create a new table with column definitions and constraints', 'write', '{"type": "object", "properties": {"sql": {"type": "string"}}}'::jsonb),
('pg-7', 'srv-postgres', 'postgres_drop_table', 'Drop a table and its indexes permanently', 'destructive', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('pg-8', 'srv-postgres', 'postgres_truncate_table', 'Truncate table data while preserving table structure', 'destructive', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('pg-9', 'srv-postgres', 'postgres_explain_analyze', 'Run EXPLAIN ANALYZE on query to inspect execution plan', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('pg-10', 'srv-postgres', 'postgres_connection_status', 'Check database connection latency and active pool statistics', 'read', '{}'::jsonb),

-- Turso Cloud SQLite (8)
('sq-1', 'srv-sqlite', 'sqlite_read_query', 'Execute read-only SQL queries against Turso libSQL SQLite database', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('sq-2', 'srv-sqlite', 'sqlite_write_query', 'Execute data modification queries (INSERT, UPDATE) in transaction', 'write', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('sq-3', 'srv-sqlite', 'sqlite_list_tables', 'List all user tables and views in SQLite schema', 'read', '{}'::jsonb),
('sq-4', 'srv-sqlite', 'sqlite_describe_table', 'Inspect table PRAGMA table_info definitions', 'read', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('sq-5', 'srv-sqlite', 'sqlite_create_table', 'Execute CREATE TABLE statement with column definitions', 'write', '{"type": "object", "properties": {"sql": {"type": "string"}}}'::jsonb),
('sq-6', 'srv-sqlite', 'sqlite_drop_table', 'Drop a table from SQLite database permanently', 'destructive', '{"type": "object", "properties": {"table_name": {"type": "string"}}}'::jsonb),
('sq-7', 'srv-sqlite', 'sqlite_create_index', 'Create index on table columns for faster lookups', 'write', '{"type": "object", "properties": {"sql": {"type": "string"}}}'::jsonb),
('sq-8', 'srv-sqlite', 'sqlite_vacuum', 'Rebuild database file to reclaim unused disk space', 'write', '{}'::jsonb),

-- Airtable Database (6)
('at-1', 'srv-airtable', 'airtable_list_records', 'Query and filter records from an Airtable table', 'read', '{"type": "object", "properties": {"base_id": {"type": "string"}, "table_id": {"type": "string"}}}'::jsonb),
('at-2', 'srv-airtable', 'airtable_get_record', 'Fetch a single record by record ID with fields and attachments', 'read', '{"type": "object", "properties": {"base_id": {"type": "string"}, "table_id": {"type": "string"}, "record_id": {"type": "string"}}}'::jsonb),
('at-3', 'srv-airtable', 'airtable_create_record', 'Insert a new record with field values into table', 'write', '{"type": "object", "properties": {"base_id": {"type": "string"}, "table_id": {"type": "string"}, "fields": {"type": "object"}}}'::jsonb),
('at-4', 'srv-airtable', 'airtable_update_record', 'Update fields of an existing Airtable record', 'write', '{"type": "object", "properties": {"base_id": {"type": "string"}, "table_id": {"type": "string"}, "record_id": {"type": "string"}, "fields": {"type": "object"}}}'::jsonb),
('at-5', 'srv-airtable', 'airtable_delete_record', 'Delete a record from Airtable permanently', 'destructive', '{"type": "object", "properties": {"base_id": {"type": "string"}, "table_id": {"type": "string"}, "record_id": {"type": "string"}}}'::jsonb),
('at-6', 'srv-airtable', 'airtable_list_bases', 'List accessible Airtable bases and schemas', 'read', '{}'::jsonb),

-- Google Maps (6)
('gm-1', 'srv-google-maps', 'maps_geocode', 'Convert a human street address or city into lat/lng coordinates', 'read', '{"type": "object", "properties": {"address": {"type": "string"}}}'::jsonb),
('gm-2', 'srv-google-maps', 'maps_reverse_geocode', 'Convert latitude and longitude coordinates into a street address', 'read', '{"type": "object", "properties": {"latitude": {"type": "number"}, "longitude": {"type": "number"}}}'::jsonb),
('gm-3', 'srv-google-maps', 'maps_search_places', 'Search nearby businesses and landmarks by text or category', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('gm-4', 'srv-google-maps', 'maps_place_details', 'Get business hours, phone number, website, and customer reviews', 'read', '{"type": "object", "properties": {"place_id": {"type": "string"}}}'::jsonb),
('gm-5', 'srv-google-maps', 'maps_directions', 'Compute driving, walking, transit directions and ETA', 'read', '{"type": "object", "properties": {"origin": {"type": "string"}, "destination": {"type": "string"}}}'::jsonb),
('gm-6', 'srv-google-maps', 'maps_elevation', 'Get elevation above sea level for GPS coordinates', 'read', '{"type": "object", "properties": {"latitude": {"type": "number"}, "longitude": {"type": "number"}}}'::jsonb),

-- Slack Team (14)
('sl-1', 'srv-slack', 'slack_post_message', 'Send a new chat message to a Slack channel', 'write', '{"type": "object", "properties": {"channel": {"type": "string"}, "text": {"type": "string"}}}'::jsonb),
('sl-2', 'srv-slack', 'slack_reply_to_thread', 'Reply to a specific message thread in a channel', 'write', '{"type": "object", "properties": {"channel": {"type": "string"}, "thread_ts": {"type": "string"}, "text": {"type": "string"}}}'::jsonb),
('sl-3', 'srv-slack', 'slack_add_reaction', 'Add emoji reaction to a message', 'write', '{"type": "object", "properties": {"channel": {"type": "string"}, "timestamp": {"type": "string"}, "name": {"type": "string"}}}'::jsonb),
('sl-4', 'srv-slack', 'slack_list_channels', 'List public and private channels in workspace', 'read', '{}'::jsonb),
('sl-5', 'srv-slack', 'slack_get_channel_history', 'Fetch recent messages from a channel', 'read', '{"type": "object", "properties": {"channel": {"type": "string"}, "limit": {"type": "integer"}}}'::jsonb),
('sl-6', 'srv-slack', 'slack_get_thread_replies', 'Fetch all replies in a message thread', 'read', '{"type": "object", "properties": {"channel": {"type": "string"}, "thread_ts": {"type": "string"}}}'::jsonb),
('sl-7', 'srv-slack', 'slack_get_user_profile', 'Get Slack user profile information and email', 'read', '{"type": "object", "properties": {"user": {"type": "string"}}}'::jsonb),
('sl-8', 'srv-slack', 'slack_list_users', 'List all users and bots in the workspace', 'read', '{}'::jsonb),
('sl-9', 'srv-slack', 'slack_set_topic', 'Update the topic description of a channel', 'write', '{"type": "object", "properties": {"channel": {"type": "string"}, "topic": {"type": "string"}}}'::jsonb),
('sl-10', 'srv-slack', 'slack_upload_file', 'Upload a text file, snippet, or document to a channel', 'write', '{"type": "object", "properties": {"channels": {"type": "string"}, "content": {"type": "string"}, "filename": {"type": "string"}}}'::jsonb),
('sl-11', 'srv-slack', 'slack_search_messages', 'Search messages across public channels with query filter', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('sl-12', 'srv-slack', 'slack_archive_channel', 'Archive a channel permanently', 'destructive', '{"type": "object", "properties": {"channel": {"type": "string"}}}'::jsonb),
('sl-13', 'srv-slack', 'slack_delete_message', 'Delete a message previously posted in a channel', 'destructive', '{"type": "object", "properties": {"channel": {"type": "string"}, "ts": {"type": "string"}}}'::jsonb),
('sl-14', 'srv-slack', 'slack_remove_reaction', 'Remove an emoji reaction from a message', 'destructive', '{"type": "object", "properties": {"channel": {"type": "string"}, "timestamp": {"type": "string"}, "name": {"type": "string"}}}'::jsonb),

-- Notion Workspace (12)
('nt-1', 'srv-notion', 'notion_search', 'Search across Notion workspace pages, documents and databases', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('nt-2', 'srv-notion', 'notion_get_page', 'Retrieve page properties, title and cover metadata', 'read', '{"type": "object", "properties": {"page_id": {"type": "string"}}}'::jsonb),
('nt-3', 'srv-notion', 'notion_create_page', 'Create a new Notion page under a parent page or database', 'write', '{"type": "object", "properties": {"parent": {"type": "object"}, "properties": {"type": "object"}}}'::jsonb),
('nt-4', 'srv-notion', 'notion_update_page', 'Update page properties, status, or tags', 'write', '{"type": "object", "properties": {"page_id": {"type": "string"}, "properties": {"type": "object"}}}'::jsonb),
('nt-5', 'srv-notion', 'notion_archive_page', 'Archive or trash a Notion page', 'destructive', '{"type": "object", "properties": {"page_id": {"type": "string"}}}'::jsonb),
('nt-6', 'srv-notion', 'notion_get_block_children', 'Get markdown block contents of a Notion page', 'read', '{"type": "object", "properties": {"block_id": {"type": "string"}}}'::jsonb),
('nt-7', 'srv-notion', 'notion_append_block_children', 'Append new paragraph, heading, or code blocks to a page', 'write', '{"type": "object", "properties": {"block_id": {"type": "string"}, "children": {"type": "array"}}}'::jsonb),
('nt-8', 'srv-notion', 'notion_delete_block', 'Delete a content block from a page', 'destructive', '{"type": "object", "properties": {"block_id": {"type": "string"}}}'::jsonb),
('nt-9', 'srv-notion', 'notion_query_database', 'Query database items with property filters and sort orders', 'read', '{"type": "object", "properties": {"database_id": {"type": "string"}}}'::jsonb),
('nt-10', 'srv-notion', 'notion_get_database', 'Retrieve database schema and column definitions', 'read', '{"type": "object", "properties": {"database_id": {"type": "string"}}}'::jsonb),
('nt-11', 'srv-notion', 'notion_create_database', 'Create a new structured database table in Notion', 'write', '{"type": "object", "properties": {"parent": {"type": "object"}, "title": {"type": "array"}}}'::jsonb),
('nt-12', 'srv-notion', 'notion_update_database', 'Update database title, description, or schema columns', 'write', '{"type": "object", "properties": {"database_id": {"type": "string"}, "title": {"type": "array"}}}'::jsonb),

-- Linear Issue Tracker (10)
('ln-1', 'srv-linear', 'linear_create_issue', 'Create a new Linear issue with team, title, priority, and description', 'write', '{"type": "object", "properties": {"teamId": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}}}'::jsonb),
('ln-2', 'srv-linear', 'linear_get_issue', 'Get full details of a Linear issue by ID or key (e.g. ENG-123)', 'read', '{"type": "object", "properties": {"id": {"type": "string"}}}'::jsonb),
('ln-3', 'srv-linear', 'linear_update_issue', 'Update issue status, assignee, priority, or estimate', 'write', '{"type": "object", "properties": {"id": {"type": "string"}, "stateId": {"type": "string"}}}'::jsonb),
('ln-4', 'srv-linear', 'linear_delete_issue', 'Delete an issue permanently from Linear', 'destructive', '{"type": "object", "properties": {"id": {"type": "string"}}}'::jsonb),
('ln-5', 'srv-linear', 'linear_list_issues', 'List issues in active cycle or filtered by project', 'read', '{"type": "object", "properties": {"teamId": {"type": "string"}}}'::jsonb),
('ln-6', 'srv-linear', 'linear_search_issues', 'Full-text search issues by keywords', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('ln-7', 'srv-linear', 'linear_create_comment', 'Add a comment to an issue thread', 'write', '{"type": "object", "properties": {"issueId": {"type": "string"}, "body": {"type": "string"}}}'::jsonb),
('ln-8', 'srv-linear', 'linear_list_projects', 'List all projects, progress percentage, and milestones', 'read', '{}'::jsonb),
('ln-9', 'srv-linear', 'linear_list_teams', 'List workspace teams and workflow states', 'read', '{}'::jsonb),
('ln-10', 'srv-linear', 'linear_list_users', 'List active organization users and avatars', 'read', '{}'::jsonb),

-- GitLab DevOps (8)
('gl-1', 'srv-gitlab', 'gitlab_get_project', 'Get repository details, visibility, and default branch', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-2', 'srv-gitlab', 'gitlab_list_projects', 'List accessible GitLab projects and groups', 'read', '{}'::jsonb),
('gl-3', 'srv-gitlab', 'gitlab_create_issue', 'Create a new issue in a GitLab project', 'write', '{"type": "object", "properties": {"project_id": {"type": "string"}, "title": {"type": "string"}}}'::jsonb),
('gl-4', 'srv-gitlab', 'gitlab_list_issues', 'List project issues filtered by milestone or label', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-5', 'srv-gitlab', 'gitlab_create_merge_request', 'Create a merge request between branches', 'write', '{"type": "object", "properties": {"project_id": {"type": "string"}, "source_branch": {"type": "string"}, "target_branch": {"type": "string"}}}'::jsonb),
('gl-6', 'srv-gitlab', 'gitlab_list_merge_requests', 'List open and merged merge requests in project', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-7', 'srv-gitlab', 'gitlab_get_file_contents', 'Fetch raw file contents from a repository commit or branch', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}, "file_path": {"type": "string"}}}'::jsonb),
('gl-8', 'srv-gitlab', 'gitlab_delete_project', 'Delete a GitLab project permanently', 'destructive', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),

-- Sentry Error Tracking (6)
('sn-1', 'srv-sentry', 'sentry_list_issues', 'List active production error issues and unhandled exceptions', 'read', '{"type": "object", "properties": {"organization_slug": {"type": "string"}, "project_slug": {"type": "string"}}}'::jsonb),
('sn-2', 'srv-sentry', 'sentry_get_issue_details', 'Get issue stacktrace, culprit, and frequency counts', 'read', '{"type": "object", "properties": {"issue_id": {"type": "string"}}}'::jsonb),
('sn-3', 'srv-sentry', 'sentry_update_issue_status', 'Resolve, ignore, or assign a Sentry issue', 'write', '{"type": "object", "properties": {"issue_id": {"type": "string"}, "status": {"type": "string"}}}'::jsonb),
('sn-4', 'srv-sentry', 'sentry_list_projects', 'List monitored applications and error volume', 'read', '{"type": "object", "properties": {"organization_slug": {"type": "string"}}}'::jsonb),
('sn-5', 'srv-sentry', 'sentry_get_latest_event', 'Inspect full breadcrumbs and HTTP request payload for an event', 'read', '{"type": "object", "properties": {"issue_id": {"type": "string"}}}'::jsonb),
('sn-6', 'srv-sentry', 'sentry_delete_issue', 'Delete an issue and all aggregated event instances permanently', 'destructive', '{"type": "object", "properties": {"issue_id": {"type": "string"}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
