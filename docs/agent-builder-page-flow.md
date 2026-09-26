# Agent Builder Page — End-to-End Flow

This document explains how the "Build an agent" page (`/build`) works from the moment
the user types a prompt to the moment a runnable agent is persisted in the database and
tools are invoked at runtime.

---

## Overview

The page is implemented in `frontend/src/pages/AgentBuilder.tsx` and progresses through
five stages driven by React state:

```
Stage 0 → Stage 1 → Stage 2 → Stage 3 → Stage 4
  Idle   Suggest   Credentials  Building   Done
         Tools
```

The right sidebar (Builder Graph) reflects the current stage visually.

---

## Stage 0 — Idle

The user types a natural-language description of what they want the agent to do and
picks a model (`gemini-2.0-flash`, `gpt-4o`, etc.) from a dropdown. Nothing is fetched
yet — this is pure local React state.

---

## Stage 1 — Suggest Tools

**Trigger:** User clicks Send (or presses Enter).

**Frontend call:**

```
GET /mcp/tools/suggest?prompt=<encoded text>
```

`api.suggestTools(prompt)` in `frontend/src/api/client.ts`.

**Backend path:** `mcp_registry.py` router → `mcp_registry.py` service →
`find_tools_for_prompt(db, owner_id, prompt)`.

### What the backend does

1. Loads all MCP servers visible to the user from PostgreSQL via
   `mcp_repo.list_visible_servers` — this includes platform-wide shared servers and any
   the user registered privately.
2. Strips stopwords from the prompt and tokenises the remainder.
3. Checks each server's **name** (not its description — too noisy) against those tokens.
   A server matches if any of its name-tokens appear in the prompt, or any prompt-keyword
   appears in the server name.
4. Returns matched servers; falls back to all servers if nothing matched.
5. Before the router returns, `_to_responses()` attaches two per-server boolean flags:
   - `connected` — user already has an active token for this server in the connections
     table.
   - `is_suggested` — the server actually matched the prompt (used to pre-check the
     checkbox).

**Frontend response:** `MCPServer[]` — each object includes the full tool list (name,
description, `permission_level`). The user sees a checkbox list of servers with
expandable tool dropdowns showing every individual tool.

---

## Stage 2 — Credentials (optional)

Skipped entirely if every selected server has `auth_type === 'none'`.

**Trigger:** User clicks "Use these N".

**`handleUseTools()` logic:**

1. Identifies selected servers that need a token (`auth_type !== 'none'`).
2. Checks the `connected` flag from Stage 1 (primary source: connections table).
3. Calls `api.getCredentialAvailability(serverNames)` as a fallback:

   ```
   GET /agents/credential-availability?servers=slack,github
   ```

   Backend scans the credentials JSONB of all the user's existing agents to find
   previously stored tokens.

4. If all servers are already connected → jumps straight to Stage 3.
5. Otherwise → renders a credential form for each server that still needs a token.

**Token verification:** When the user clicks "Connect & Build":

```
POST /agents/verify-token  { "server": "github", "token": "ghp_..." }
```

Backend calls `verify_pat_token(server, token)`, which makes a live HTTP call to the
service (e.g. `GET https://api.github.com/user`) and returns `{ ok, message }`.
All tokens must pass before the stage advances.

---

## Stage 3 — Build

**Trigger:** `useEffect` watching `stage` fires as soon as `stage === 3`.

**Frontend call:**

```
POST /agents
{
  "name": "slack_search_agent",
  "description": "I need an agent who can search and post to Slack",
  "system_prompt": "You are a helpful assistant. ...",
  "model_id": "gemini-2.0-flash",
  "temperature": 0.0,
  "tool_ids": ["<uuid>", "<uuid>", ...],
  "user_prompt": "<original prompt>",
  "credentials": { "slack": "xoxb-...", "tavily": "tvly-..." }
}
```

**Backend path:** `agents.py:create_agent()`.

### Step 1 — `build_agent_config()`  (`agent_builder.py`)

- Fetches `Tool` rows from PostgreSQL by the UUID list (`tool_ids`), joining each tool
  with its parent server row.
- Runs `_select_relevant_tools()`:
  1. `_filter_by_intent()` — groups tools by server, infers read vs. write intent from
     the prompt (e.g. "post to Slack" → write intent for Slack), and keeps only the
     matching permission tier.
  2. If more than 5 tools remain, calls the LLM with a structured prompt to pick the
     most relevant subset.
- Assembles `AgentConfigSchema` — the declarative JSONB config stored in the DB:
  - `ModelConfig` — provider, model_id, temperature.
  - `list[ToolConfig]` — one entry per selected tool with name, description,
    input_schema, permission_level, and whether it requires human approval.
  - `GraphConfig` — `type="react_agent"`.

### Step 2 — Credential resolution

Merges credentials from three sources in priority order:

1. Explicit tokens from the request body.
2. Active tokens from the **connections** table (`conn_repo.list_connections`).
3. Reusable tokens found in the user's other agents (`agent_repo.get_reusable_token_for_server`).

`__CONNECTION__` sentinel values (sent by the frontend for already-connected servers)
are replaced with the real token here.

### Step 3 — `agent_repo.save_agent()`

Persists an `Agent` row to PostgreSQL:

| Column | Value |
|--------|-------|
| `id` | new UUID |
| `name` | from request |
| `description` | from request |
| `status` | `"draft"` |
| `config` | `AgentConfigSchema` serialised as JSONB |
| `credentials` | `{ server_name → token }` as JSONB (never returned in API responses) |
| `api_token` | freshly generated UUID for external API access |

---

## Stage 4 — Done

Frontend receives the `Agent` object and renders a summary card showing the agent name,
model, tool count grouped by server (with read/write/destructive badges), and two
navigation buttons: **Open Playground** and **Go to My Agents**.

---

## Runtime — How Tools Are Invoked

When the user sends a message in the Playground:

```
POST /agents/{id}/run  { "message": "search Google for X and post to Slack" }
```

**Backend path:** `agents.py:run_agent()` → `execute_agent()` in `agent_builder.py`.

### Execution loop

```
1. Load agent config + merge credentials
   (connections table overrides stored agent creds)

2. Build LLM
   "gpt" in model_id → ChatOpenAI
   otherwise         → ChatGoogleGenerativeAI

3. Build placeholder tools
   One LangChain StructuredTool per ToolConfig —
   the LLM sees names, descriptions, and input schemas
   but execution is intercepted by the framework.

4. create_react_agent(llm, tools, system_prompt,
                      interrupt_before=["tools"])
   The graph PAUSES before executing any tool call.

5. graph.ainvoke({"messages": [("human", message)]})

6. _handle_graph_state() — up to 20 iterations:
   ┌─ inspect pending tool calls
   │
   ├─ tool is write/destructive?
   │    → return pending_approval response
   │      frontend shows Approve / Reject UI
   │
   └─ tool is read (or approved)?
        → _execute_real_tool(config, credentials, name, args)
             ├─ "slack"  in server → _execute_slack_tool()  → Slack Web API
             ├─ "github" in server → _execute_github_tool() → GitHub REST API
             ├─ "tavily" in server → _execute_tavily_tool() → Tavily search/extract API
             └─ anything else      → generic placeholder
        → result injected as ToolMessage
        → graph.ainvoke(None) — LLM continues with tool result
        → repeat

7. Final LLM message content → AgentRunResponse { output }
```

### Tool permission enforcement

Every tool call is classified by `_tool_needs_approval(tool_name)` — this tokenises the
tool name and matches against hardcoded sets of destructive and write keywords,
independent of whatever `permission_level` is stored in the DB. Write/destructive calls
pause execution and surface an approval card in the UI; read calls execute automatically.

---

## Data Flow Diagram

```
User types prompt
       │
       ▼
GET /mcp/tools/suggest          keyword match → PostgreSQL mcp_servers + mcp_tools
       │
       ▼
User checks servers / enters tokens
       │
       ▼
POST /agents/verify-token       live API call (GitHub/Slack/Tavily) → { ok, message }
       │
       ▼
POST /agents                    build_agent_config()
       │                            └─ fetch Tool rows (PostgreSQL)
       │                            └─ LLM-assisted tool selection
       │                        credential resolution (connections table)
       │                        save_agent() → PostgreSQL (config JSONB)
       ▼
Agent row persisted
       │
       ▼ (later, in Playground)
POST /agents/{id}/run
       │
       ├─ LangGraph ReAct loop (interrupt_before=["tools"])
       ├─ _execute_real_tool() → httpx → external API
       ├─ result fed back into graph as ToolMessage
       └─ LLM generates final answer → frontend
```

---

## Key Files

| Concern | File |
|---------|------|
| UI / stage machine | `frontend/src/pages/AgentBuilder.tsx` |
| API client | `frontend/src/api/client.ts` |
| Tool suggestion endpoint | `backend/app/routers/mcp_registry.py` |
| Tool suggestion logic | `backend/app/services/mcp_registry.py` |
| Agent creation endpoint | `backend/app/routers/agents.py` |
| Agent config builder + runtime | `backend/app/services/agent_builder.py` |
| GitHub tool implementations | `backend/app/services/github_tools.py` |
| MCP server / tool DB queries | `backend/app/repositories/mcp.py` |
| Agent DB queries | `backend/app/repositories/agent.py` |
