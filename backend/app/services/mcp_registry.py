import json
import logging
import os
import sqlite3
import uuid

import httpx2
from fastapi import HTTPException
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.mcp import MCPServer, MCPTool
from app.repositories import mcp as mcp_repo

logger = logging.getLogger(__name__)

_DESTRUCTIVE = {"delete", "remove", "destroy", "revoke", "dismiss", "close", "cancel"}
_WRITE = {"create", "post", "push", "write", "update", "edit", "merge", "add",
          "submit", "approve", "request", "assign", "label", "comment", "reply"}


def _classify_permission(name: str) -> str:
    tokens = set(name.lower().replace("_", " ").split())
    if tokens & _DESTRUCTIVE:
        return "destructive"
    if tokens & _WRITE:
        return "write"
    return "read"


async def discover_tools_from_mcp(endpoint: str, token: str) -> list[dict]:
    """Connect to an MCP server and return its tools as a list of dicts."""
    http_client = httpx2.AsyncClient(
        headers={"Authorization": f"Bearer {token}"}
    )
    async with streamable_http_client(endpoint, http_client=http_client) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools_response = await session.list_tools()
            return [
                {
                    "name": t.name,
                    "description": t.description or "",
                    "input_schema": t.inputSchema if isinstance(t.inputSchema, dict) else {},
                    "permission_level": _classify_permission(t.name),
                }
                for t in tools_response.tools
            ]


async def list_servers(db: AsyncSession, owner_id: uuid.UUID) -> list[MCPServer]:
    return await mcp_repo.list_visible_servers(db, owner_id)


async def get_server_tools(db: AsyncSession, server_id: uuid.UUID) -> list[MCPTool]:
    server = await mcp_repo.get_server_with_tools(db, server_id)
    if server is None:
        return []
    return server.tools


_STOPWORDS = {"a", "an", "the", "and", "or", "to", "in", "on", "at", "of", "for",
              "is", "it", "my", "me", "i", "with", "from", "that", "this", "can",
              "all", "get", "fetch", "post", "send", "read", "use", "then", "if"}


async def find_tools_for_prompt(db: AsyncSession, owner_id: uuid.UUID, prompt: str) -> list[MCPServer]:
    servers = await mcp_repo.list_visible_servers(db, owner_id)
    prompt_lower = prompt.lower()

    # keywords from the prompt (skip stopwords)
    prompt_keywords = {
        w.strip(".,!?") for w in prompt_lower.split()
        if w.strip(".,!?") not in _STOPWORDS and len(w) > 2
    }

    matched: list[MCPServer] = []
    for server in servers:
        # tokenise server name only — description is too noisy for matching
        name_tokens = set(server.name.lower().replace("-", " ").replace("_", " ").split())

        # a server is suggested only when its name appears in the prompt
        # or a prompt keyword matches the server name directly
        hits_prompt = any(tok in prompt_lower for tok in name_tokens)
        hits_server = any(kw in server.name.lower() for kw in prompt_keywords)

        if hits_prompt or hits_server:
            matched.append(server)

    return matched if matched else servers


def get_external_catalog(registered_names: set[str]) -> list[dict]:
    """Reads available MCP servers and tools from MyMCPRegistry SQLite database."""
    db_path = settings.my_mcp_registry_db
    if not os.path.exists(db_path):
        logger.warning("MyMCPRegistry DB not found at %s", db_path)
        return []

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM mcp_servers ORDER BY category, name")
        rows = c.fetchall()

        result = []
        for r in rows:
            server = dict(r)
            s_id = server["id"]
            name = server["name"]

            c.execute(
                "SELECT name, description, risk_level, input_schema FROM mcp_tools WHERE server_id = ? ORDER BY name",
                (s_id,),
            )
            tools_rows = c.fetchall()
            tools = []
            for tr in tools_rows:
                schema = tr["input_schema"]
                if isinstance(schema, str):
                    try:
                        schema = json.loads(schema)
                    except Exception:
                        schema = {}
                tools.append({
                    "name": tr["name"],
                    "description": tr["description"] or "",
                    "permission_level": tr["risk_level"] or "read",
                    "input_schema": schema if isinstance(schema, dict) else {},
                })

            result.append({
                "id": s_id,
                "name": name,
                "display_name": server.get("display_name") or f"{name.title()} MCP",
                "description": server.get("description") or "",
                "category": server.get("category") or "Dev Tools",
                "package_name": server.get("package_name") or "",
                "transport": server.get("transport") or "stdio",
                "command": server.get("command") or "",
                "url": server.get("url") or "",
                "endpoint": server.get("url") or server.get("command") or "",
                "auth_type": server.get("auth_type") or "none",
                "token_guide": server.get("token_guide") or "",
                "tools_count": len(tools),
                "tools": tools,
                "is_registered": name.lower() in registered_names,
            })
        conn.close()
        return result
    except Exception as exc:
        logger.error("Failed to load external MCP catalog from %s: %s", db_path, exc)
        return []


async def register_from_external_catalog(
    db: AsyncSession,
    owner_id: uuid.UUID,
    server_name: str,
    token: str = "",
    is_shared: bool = True,
) -> MCPServer:
    """Registers an MCP server and all its catalog tools from MyMCPRegistry into AgentFactory."""
    catalog = get_external_catalog(set())
    target = next((s for s in catalog if s["name"].lower() == server_name.lower()), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Server '{server_name}' not found in MyMCPRegistry")

    existing = await mcp_repo.get_server_by_name(db, target["name"])
    if existing:
        raise HTTPException(status_code=409, detail=f"Server '{target['name']}' is already registered in AgentFactory.")

    endpoint = target["url"] or target["command"] or f"https://mcp.example.com/{target['name']}"
    server = await mcp_repo.create_server(
        db,
        owner_id=owner_id,
        name=target["name"],
        description=target["description"],
        transport=target["transport"],
        endpoint=endpoint,
        auth_type=target["auth_type"],
        is_shared=is_shared,
        status="healthy",
    )

    for tool in target["tools"]:
        await mcp_repo.create_tool(
            db,
            mcp_server_id=server.id,
            name=tool["name"],
            description=tool["description"],
            permission_level=tool["permission_level"],
            input_schema=tool["input_schema"],
        )

    # If an auth token is provided during registration, strictly verify it before storing
    if token.strip():
        from app.services.github_tools import verify_pat_token
        ok, msg = verify_pat_token(target["name"], token.strip(), endpoint)
        if not ok:
            raise HTTPException(status_code=422, detail=f"Token verification failed for {target['name']}: {msg}")

        from app.repositories import connection as conn_repo
        await conn_repo.upsert_connection(
            db,
            user_id=owner_id,
            server_name=target["name"],
            token=token.strip(),
        )

    await db.commit()
    refreshed = await mcp_repo.get_server_with_tools(db, server.id)
    return refreshed or server
