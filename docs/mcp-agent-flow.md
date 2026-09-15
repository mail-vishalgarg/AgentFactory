# MCP → Agent Full Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PHASE 1 — Register MCP Server                    │
└─────────────────────────────────────────────────────────────────────────┘

  User (Frontend)
       │  POST /mcp/servers { name, endpoint, token }
       ▼
  mcp_registry router
       │
       ├─► discover_tools_from_mcp(endpoint, token)
       │        │  opens live MCP connection (streamable_http_client)
       │        │  calls session.list_tools()
       │        │  auto-classifies permission (read/write/destructive)
       │        └─► returns list[dict]
       │
       └─► mcp_repo.create_server()  ──► MCPServer row (PostgreSQL)
           mcp_repo.create_tool()    ──► MCPTool rows  (PostgreSQL)
                                          { name, description,
                                            input_schema, permission_level }


┌─────────────────────────────────────────────────────────────────────────┐
│                        PHASE 2 — Build an Agent                         │
└─────────────────────────────────────────────────────────────────────────┘

  User (Frontend)
       │  POST /agents { tool_ids: [UUID, ...], model_id, system_prompt, ... }
       ▼
  agents router
       │
       └─► build_agent_config(db, request)
                │
                ├─► mcp_repo.get_tools_by_ids(db, tool_ids)
                │        └─► SELECT MCPTool JOIN MCPServer WHERE id IN (...)
                │
                ├─► builds ToolConfig[] from DB rows
                │        { mcp_server_name, tool_name, description,
                │           input_schema, permission_level }
                │
                └─► AgentConfigSchema (JSONB) ──► Agent row (PostgreSQL)
                                                   { config, credentials }
                                                     no live MCP call here


┌─────────────────────────────────────────────────────────────────────────┐
│                        PHASE 3 — Run the Agent                          │
└─────────────────────────────────────────────────────────────────────────┘

  User (Frontend)
       │  POST /agents/{id}/run { message }
       ▼
  agents router
       │
       ├─► agent_repo.get_agent(db, id)  ──► loads config + credentials
       │
       └─► execute_agent(config, credentials, message)
                │
                ├── github token present?  ──YES──► open live MCP session
                │                                    api.githubcopilot.com/mcp
                │                                    load_mcp_tools(session)
                │                                    filter to selected tools only
                │
                ├── slack token present?   ──YES──► open live MCP session
                │                                    mcp.slack.com/mcp
                │                                    load_mcp_tools(session)
                │                                    filter to selected tools only
                │
                ├── other servers          ──────► placeholder tools
                │                                   (echo args, no real calls)
                │
                └─► create_react_agent(llm, all_tools, system_prompt)
                         │   LangGraph ReAct loop
                         │   LLM decides which tool to call
                         │   tool executes → result back to LLM
                         │   repeats until final answer
                         └─► returns final message text
```

> **Key insight:** Phase 1 & 3 make live MCP connections; Phase 2 is pure DB metadata storage.
> The tool's `input_schema` stored in Phase 1 tells the LLM *how* to call each tool,
> while the live MCP session in Phase 3 actually executes the calls.
