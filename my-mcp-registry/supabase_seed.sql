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
('srv-tavily', 'tavily', 'Tavily AI Search MCP', 'Search engine specifically optimized for LLMs and autonomous agents with clean markdown extracts.', 'AI & Web', 'tavily-mcp', 'stdio', 'npx -y tavily-mcp', '[]'::jsonb, '{"TAVILY_API_KEY": "<tavily-api-key>"}'::jsonb, 'https://api.tavily.com', 'api_key', 'Get Tavily API Key: https://app.tavily.com/home (1,000 free searches/month)', 'ok', true),
('srv-slack', 'slack', 'Slack Team MCP', 'Official Slack MCP Server: send channel messages, reply to threads, upload files, and manage reactions.', 'Productivity', '@modelcontextprotocol/server-slack', 'stdio', 'npx -y @modelcontextprotocol/server-slack', '[]'::jsonb, '{"SLACK_BOT_TOKEN": "xoxb-<your-slack-bot-token>"}'::jsonb, 'https://slack.com/api', 'api_key', 'Create Slack Bot Token (xoxb): https://api.slack.com/apps (OAuth & Permissions -> Bot Token Scopes)', 'ok', true),
('srv-gitlab', 'gitlab', 'GitLab DevOps MCP', 'DevOps MCP Server: manage GitLab projects, merge requests, issues, CI/CD pipelines, and source files.', 'Dev Tools', '@modelcontextprotocol/server-gitlab', 'stdio', 'npx -y @modelcontextprotocol/server-gitlab', '[]'::jsonb, '{"GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-<your-gitlab-token>"}'::jsonb, 'https://gitlab.com/api/v4', 'api_key', 'Generate GitLab Access Token: https://gitlab.com/-/user_settings/personal_access_tokens (Select api scope)', 'ok', true)
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


-- Tavily AI Search (4)
('tv-1', 'srv-tavily', 'tavily_search', 'Search web and return AI-ready markdown content and citations', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('tv-2', 'srv-tavily', 'tavily_extract', 'Extract clean markdown article body from any URL', 'read', '{"type": "object", "properties": {"urls": {"type": "array"}}}'::jsonb),
('tv-3', 'srv-tavily', 'tavily_qna_search', 'Direct question-answering search with synthesized reply', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),
('tv-4', 'srv-tavily', 'tavily_get_search_context', 'Retrieve concise context string tailored for LLM RAG pipelines', 'read', '{"type": "object", "properties": {"query": {"type": "string"}}}'::jsonb),

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

-- GitLab DevOps (8)
('gl-1', 'srv-gitlab', 'gitlab_get_project', 'Get repository details, visibility, and default branch', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-2', 'srv-gitlab', 'gitlab_list_projects', 'List accessible GitLab projects and groups', 'read', '{}'::jsonb),
('gl-3', 'srv-gitlab', 'gitlab_create_issue', 'Create a new issue in a GitLab project', 'write', '{"type": "object", "properties": {"project_id": {"type": "string"}, "title": {"type": "string"}}}'::jsonb),
('gl-4', 'srv-gitlab', 'gitlab_list_issues', 'List project issues filtered by milestone or label', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-5', 'srv-gitlab', 'gitlab_create_merge_request', 'Create a merge request between branches', 'write', '{"type": "object", "properties": {"project_id": {"type": "string"}, "source_branch": {"type": "string"}, "target_branch": {"type": "string"}}}'::jsonb),
('gl-6', 'srv-gitlab', 'gitlab_list_merge_requests', 'List open and merged merge requests in project', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb),
('gl-7', 'srv-gitlab', 'gitlab_get_file_contents', 'Fetch raw file contents from a repository commit or branch', 'read', '{"type": "object", "properties": {"project_id": {"type": "string"}, "file_path": {"type": "string"}}}'::jsonb),
('gl-8', 'srv-gitlab', 'gitlab_delete_project', 'Delete a GitLab project permanently', 'destructive', '{"type": "object", "properties": {"project_id": {"type": "string"}}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
