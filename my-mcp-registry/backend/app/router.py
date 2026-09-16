from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app import db, mcp_client

router = APIRouter(prefix="/api/servers", tags=["mcp_servers"])

class ServerRegisterRequest(BaseModel):
    name: str = Field(..., description="Unique server name (e.g. github, custom-db)")
    display_name: Optional[str] = None
    category: str = Field(default="Dev Tools", description="Category pill name")
    transport: str = Field(default="stdio", description="stdio, http, or sse")
    command: Optional[str] = Field(default=None, description="stdio command e.g. npx -y @modelcontextprotocol/server-...")
    command_args: List[str] = Field(default_factory=list)
    env_vars: Dict[str, str] = Field(default_factory=dict)
    url: Optional[str] = Field(default=None, description="HTTP / SSE endpoint")
    auth_type: str = Field(default="none")
    description: Optional[str] = None

@router.get("")
async def list_servers(
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search term across names and tools")
):
    """Fetches all MCP servers and their full tool catalogs directly from the SQL database."""
    return await db.get_all_servers(category=category, search=search)

@router.get("/{server_id}")
async def get_server(server_id: str):
    """Fetches details and all tools of a specific MCP server from SQL."""
    server = await db.get_server_by_id(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found in SQL database")
    return server

@router.post("")
async def register_server(req: ServerRegisterRequest):
    """
    Registers a new MCP server.
    Dynamically connects and introspects its tools using real MCP protocol.
    Rule: '✕ If it does not answer, nothing is saved.'
    """
    target = req.url if req.transport in ["http", "sse"] else (req.command or req.url)
    if not target:
        raise HTTPException(status_code=400, detail="Missing command or endpoint URL for introspection")

    # 1. Real MCP Introspection
    intro = await mcp_client.introspect_mcp(transport=req.transport, target=target, args=req.command_args)

    if intro.get("status") != "ok":
        raise HTTPException(
            status_code=400,
            detail=f"✕ If it does not answer, nothing is saved. (Could not connect to '{target}')"
        )

    tools = intro.get("tools", [])
    if not tools:
        raise HTTPException(
            status_code=400,
            detail=f"Connection succeeded but no tools were exported by '{target}'. Nothing was saved."
        )

    # 2. Persist server and tools to SQL table
    server_data = {
        "id": f"srv-{req.name}",
        "name": req.name,
        "display_name": req.display_name or f"{req.name.title()} MCP",
        "description": req.description or f"Custom registered {req.name} MCP server.",
        "category": req.category,
        "package_name": req.command or req.name,
        "transport": req.transport,
        "command": req.command or (target if req.transport == "stdio" else ""),
        "command_args": req.command_args,
        "env_vars": req.env_vars,
        "url": req.url or (target if req.transport != "stdio" else ""),
        "auth_type": req.auth_type,
        "status": "ok"
    }

    saved = await db.save_server_and_tools(server_data, tools)
    return saved

@router.post("/{server_id}/introspect")
async def reintrospect_server(server_id: str):
    """Re-runs dynamic MCP introspection against an existing server and updates its tools in SQL."""
    server = await db.get_server_by_id(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found in SQL database")

    target = server.get("url") if server.get("transport") in ["http", "sse"] else server.get("command")
    intro = await mcp_client.introspect_mcp(transport=server.get("transport", "stdio"), target=target, args=server.get("command_args", []))

    if intro.get("status") == "ok" and intro.get("tools"):
        updated = await db.save_server_and_tools(server, intro["tools"])
        return {"status": "ok", "tools_count": len(intro["tools"]), "server": updated}
    else:
        return {"status": "unreachable", "detail": "Server did not answer introspection"}

@router.get("/{server_id}/export")
async def export_config(
    server_id: str,
    format: str = Query("claude", description="claude, cursor, langgraph, json")
):
    """Generates ready-to-use client connection snippets for Claude Desktop, Cursor, or LangGraph."""
    server = await db.get_server_by_id(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found in SQL database")
    return db.export_server_config(server, fmt=format)

@router.delete("/{server_id}")
async def delete_server(server_id: str):
    """Deletes an MCP server and all its tools from the SQL tables."""
    deleted = await db.delete_server(server_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Server not found in SQL database")
    return {"status": "deleted", "id": server_id}
