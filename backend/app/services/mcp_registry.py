import logging
import uuid

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.ext.asyncio import AsyncSession

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

_SEED_SERVERS = [
    {
        "name": "github",
        "description": "Issues, pull requests, commits and repository trees.",
        "transport": "http",
        "endpoint": "https://mcp.example.com/github",
        "auth_type": "api_key",
        "tools": [
            {
                "name": "list_issues",
                "description": "List open issues in a repository",
                "permission_level": "read",
            },
            {
                "name": "get_issue",
                "description": "Get details of a specific issue",
                "permission_level": "read",
            },
            {
                "name": "get_last_commit",
                "description": "Get the most recent commit on a branch of a repository",
                "permission_level": "read",
            },
        ],
    },
    {
        "name": "slack",
        "description": "Read channels and post messages to a workspace.",
        "transport": "http",
        "endpoint": "https://mcp.example.com/slack",
        "auth_type": "oauth",
        "tools": [
            {
                "name": "read_channel",
                "description": "Read messages from a Slack channel",
                "permission_level": "read",
            },
            {
                "name": "post_message",
                "description": "Post a message to a Slack channel",
                "permission_level": "write",
            },
        ],
    },
]


async def seed_mcp_data(db: AsyncSession) -> None:
    for server_data in _SEED_SERVERS:
        existing = await mcp_repo.get_server_by_name(db, server_data["name"])
        if existing:
            continue

        tools = server_data.pop("tools")
        server = await mcp_repo.create_server(db, **server_data)

        for tool_data in tools:
            await mcp_repo.create_tool(db, mcp_server_id=server.id, input_schema={}, **tool_data)

        await db.commit()
        # restore for next iteration
        server_data["tools"] = tools


async def list_servers(db: AsyncSession) -> list[MCPServer]:
    return await mcp_repo.list_all_servers(db)


async def get_server_tools(db: AsyncSession, server_id: uuid.UUID) -> list[MCPTool]:
    server = await mcp_repo.get_server_with_tools(db, server_id)
    if server is None:
        return []
    return server.tools


_STOPWORDS = {"a", "an", "the", "and", "or", "to", "in", "on", "at", "of", "for",
              "is", "it", "my", "me", "i", "with", "from", "that", "this", "can",
              "all", "get", "fetch", "post", "send", "read", "use", "then", "if"}


async def find_tools_for_prompt(db: AsyncSession, prompt: str) -> list[MCPServer]:
    servers = await mcp_repo.list_all_servers(db)
    prompt_lower = prompt.lower()

    # keywords from the prompt (skip stopwords)
    prompt_keywords = {
        w.strip(".,!?") for w in prompt_lower.split()
        if w.strip(".,!?") not in _STOPWORDS and len(w) > 2
    }

    matched: list[MCPServer] = []
    for server in servers:
        # tokenise the server name on hyphens/underscores so "github-vishal" → {"github", "vishal"}
        name_tokens = set(server.name.lower().replace("-", " ").replace("_", " ").split())
        desc_tokens = {
            w.strip(".,!?") for w in (server.description or "").lower().split()
            if len(w) > 3
        }
        server_keywords = name_tokens | desc_tokens

        # match if any server keyword appears in the prompt OR any prompt keyword appears in the server name/desc
        hits_prompt = any(tok in prompt_lower for tok in server_keywords)
        hits_server = any(kw in server.name.lower() or kw in (server.description or "").lower()
                          for kw in prompt_keywords)

        if hits_prompt or hits_server:
            matched.append(server)

    return matched if matched else servers
