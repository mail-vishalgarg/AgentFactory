# MVP AgentBuilder

A platform for registering MCP (Model Context Protocol) servers, discovering their tools, and building LangGraph-powered agents from natural-language prompts — no hand-coding required.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, uv, LangGraph, LangChain |
| Frontend | React 18, Vite, TypeScript, TailwindCSS |
| Database | PostgreSQL (via Supabase) |
| Agent orchestration | LangGraph + LangChain + Gemini / OpenAI |

## Folder Layout

```
MVP_AgentBuilder/
├── backend/              # FastAPI app
│   ├── app/
│   │   ├── main.py       # app entrypoint
│   │   ├── routers/      # thin route handlers
│   │   └── services/     # business logic
│   └── pyproject.toml    # uv-managed deps
├── frontend/             # React + Vite + TypeScript
├── supabase/
│   └── migrations/       # SQL migration files
├── docs/                 # design docs
├── prompts/              # prompt templates
└── .claude/rules/        # coding & security rules
```

## Running Locally

### Backend
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Database
Copy `.env.example` to `.env`, fill in values, then run Supabase migrations.

## Golden Rules

1. **Typed Python** — all functions have type annotations; Pydantic models for every request/response.
2. **Small functions** — routers delegate to services; services stay under 50 lines.
3. **No secrets in code** — read all config from environment variables only.
4. **Tests for business logic** — every service function has a corresponding test.
5. **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:` prefixes required.


### Run both the servers 
Both backend (localhost:8000) and frontend (localhost:5173) need to stay running. If you close the terminal they'll stop — just re-run:
# Backend
cd backend && uv run uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev

## Agent Creation Flow

### How an agent is created — end to end

#### Frontend stages (`frontend/src/pages/AgentBuilder.tsx`)

| Stage | What happens |
|-------|-------------|
| 0 — Idle | User types a natural-language prompt describing what the agent should do |
| 1 — Suggest tools | `api.suggestTools(prompt)` fetches matching MCP servers from the registry; user checks/unchecks servers |
| 2 — Credentials | For every selected server with `auth_type !== 'none'`, user enters a token; `api.verifyToken(server, token)` validates it (`POST /agents/verify-token`) |
| 3 — Building | `api.createAgent(payload)` fires (`POST /agents`); spinner shown |
| 4 — Done | Built agent card displayed; links to Playground or My Agents |

Stage 2 is skipped if all selected servers need no auth.  
`deriveNameDesc(prompt)` splits the prompt into `name` (first sentence, ≤60 chars) and `description` (remainder) — no LLM call for naming.

#### Backend: `POST /agents` (`backend/app/routers/agents.py` → `backend/app/services/agent_builder.py`)

```
POST /agents
  └─ build_agent_config(db, request)          # agent_builder.py:16
       ├─ mcp_repo.get_tools_by_ids(db, tool_ids)   # fetch Tool rows + joined Server
       └─ returns AgentConfigSchema
            ├─ ModelConfig  (provider, model_id, temperature)
            ├─ list[ToolConfig]  (one per selected tool)
            └─ GraphConfig  (type="react_agent", checkpointer=False)
  └─ agent_repo.save_agent(db, name, description, config_dict, credentials)
       └─ persists Agent row to PostgreSQL (config stored as JSONB)
  └─ returns AgentResponse
```

Key types:
- `AgentCreate` — inbound request: `name`, `description`, `system_prompt`, `model_id`, `temperature`, `tool_ids: list[UUID]`, `credentials: dict[str,str]`
- `AgentConfigSchema` — the full declarative config stored in the DB (version, agent_id, model, system_prompt, tools, graph, metadata)

#### Agent runtime: `POST /agents/{id}/run` (`backend/app/routers/agents.py:83`)

```
POST /agents/{id}/run  { "message": "..." }
  └─ agent_repo.get_agent(db, agent_id)        # load saved config + credentials
  └─ build_langgraph_agent(config, credentials) # agent_builder.py:55
       ├─ ChatOpenAI(model_id, temperature, api_key)
       ├─ _resolve_tools(tool_configs, credentials)
       │    ├─ github token → make_github_tools(token)  (real HTTP calls to api.github.com)
       │    └─ all others  → make_placeholder_tool(server, name, description)
       └─ create_react_agent(llm, tools, prompt=system_prompt)   # LangGraph ReAct
  └─ graph.ainvoke({"messages": [("human", message)]})
  └─ returns AgentRunResponse { output, agent_id }
```

#### Tool resolution logic (`backend/app/services/agent_builder.py:81`)

- **GitHub server + github token present** → real `StructuredTool` wrappers (`list_issues`, `get_issue`, `get_last_commit`) that call `api.github.com` via `httpx`
- **Slack server + slack token present** → placeholder (real Slack calls not yet implemented)
- **Everything else** → placeholder tool that echoes its arguments

Credential keys are matched by substring (`"github" in key.lower()`), so key names like `my-github-token` or `github-username` all resolve correctly.

#### Real GitHub tools (`backend/app/services/github_tools.py`)

| Tool name | What it does |
|-----------|-------------|
| `github__list_issues` | `GET /repos/{owner}/{repo}/issues` — lists up to 20 issues |
| `github__get_issue` | `GET /repos/{owner}/{repo}/issues/{number}` — full issue detail |
| `github__get_last_commit` | `GET /repos/{owner}/{repo}/commits?sha={branch}&per_page=1` |

Token verification: `GET https://api.github.com/user` — returns `(ok, "Connected as {login}")`.

#### Data model summary

```
Agent (PostgreSQL)
├── id: UUID
├── name: str
├── description: str
├── status: str          ("active")
├── config: JSONB        (AgentConfigSchema serialized)
├── credentials: JSONB   (server_name → raw token, never returned in API responses)
└── created_at: datetime
```