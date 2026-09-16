# Agent Runtime Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POST /agents/{id}/run  { "message": "..." }              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 1. LOAD CONFIG FROM DB                                                   │
  │                                                                          │
  │   agent_repo.get_agent_for_owner(db, agent_id, user.id)                 │
  │        └─► Agent row (PostgreSQL)                                        │
  │              ├── config: JSONB  ──► AgentConfigSchema                    │
  │              │     ├── model: { provider, model_id, temperature }        │
  │              │     ├── system_prompt: str                                │
  │              │     └── tools: [ ToolConfig, ... ]                        │
  │              │           ├── mcp_server_name  ("github" / "slack" / ...) │
  │              │           ├── tool_name         ("list_issues", ...)      │
  │              │           ├── tool_description                            │
  │              │           └── input_schema  (args the LLM must fill)      │
  │              └── credentials: JSONB  { "github": "ghp_...",              │
  │                                        "slack":  "xoxb-..." }            │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 2. TOOL RESOLUTION  (execute_agent → _run_with_mcp or placeholders)      │
  │                                                                          │
  │   for each tool in config.tools:                                         │
  │                                                                          │
  │   mcp_server_name contains "github"  AND  github token present?          │
  │   ──YES──► open live MCP session → api.githubcopilot.com/mcp             │
  │            Bearer: ghp_...                                               │
  │            load_mcp_tools(session)   ← all tools from GitHub MCP         │
  │            filter to only selected tool_names                            │
  │            ──► LangChain StructuredTool[]  (real HTTP calls)             │
  │                                                                          │
  │   mcp_server_name contains "slack"   AND  slack token present?           │
  │   ──YES──► open live MCP session → mcp.slack.com/mcp                    │
  │            Bearer: xoxb-...                                              │
  │            load_mcp_tools(session)   ← all tools from Slack MCP          │
  │            filter to only selected tool_names                            │
  │            ──► LangChain StructuredTool[]  (real HTTP calls)             │
  │                                                                          │
  │   anything else  ──► make_placeholder_tool(server, name, description)   │
  │                       echoes args, no real external calls                │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 3. BUILD LANGGRAPH ReAct AGENT                                           │
  │                                                                          │
  │   llm = ChatOpenAI(model_id, temperature, api_key=OPENAI_API_KEY)        │
  │                                                                          │
  │   graph = create_react_agent(                                            │
  │       model  = llm,                                                      │
  │       tools  = all_tools,   ← resolved above                             │
  │       prompt = system_prompt                                             │
  │   )                                                                      │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 4. ReAct LOOP  (LangGraph manages state)                                 │
  │                                                                          │
  │   graph.ainvoke({ "messages": [("human", message)] })                   │
  │                                                                          │
  │   ┌─ THINK ──────────────────────────────────────────────────────────┐  │
  │   │  LLM reads: system_prompt + user message + tool schemas          │  │
  │   │  Decides: which tool to call + what args to pass                 │  │
  │   └──────────────────────────────────────────────────────────────────┘  │
  │              │  tool_call: { name: "list_issues",                        │
  │              │               args: { owner: "...", repo: "..." } }       │
  │              ▼                                                           │
  │   ┌─ ACT ────────────────────────────────────────────────────────────┐  │
  │   │  LangGraph dispatches to the matching StructuredTool             │  │
  │   │  Tool makes real HTTP call (GitHub/Slack API)                    │  │
  │   │  Returns result as ToolMessage                                   │  │
  │   └──────────────────────────────────────────────────────────────────┘  │
  │              │  result: [{ "number": 42, "title": "..." }, ...]          │
  │              ▼                                                           │
  │   ┌─ OBSERVE ────────────────────────────────────────────────────────┐  │
  │   │  LLM reads tool result, decides:                                 │  │
  │   │    → call another tool?  (loops back to THINK)                   │  │
  │   │    → done? emit final AIMessage                                  │  │
  │   └──────────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 5. RECORD RUN + RETURN                                                   │
  │                                                                          │
  │   run_repo.record_run(db, agent_id, status, latency_ms, cost_usd)       │
  │   agent_repo.touch_server_last_used(db, agent_id, server_names)         │
  │                                                                          │
  │   AgentRunResponse { output: "...", agent_id: "..." }                   │
  └──────────────────────────────────────────────────────────────────────────┘
```

> **Key point on tool selection:** The LLM never sees *all* tools — it only sees the tools
> the user selected when building the agent (`config.tools`). The `input_schema` stored per
> tool is what the LLM uses to know exactly what arguments to pass.
