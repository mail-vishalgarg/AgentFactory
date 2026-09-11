import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.repositories import mcp as mcp_repo
from app.schemas.mcp import MCPServerCreate, MCPServerResponse
from app.services import mcp_registry as svc

router = APIRouter()
logger = logging.getLogger(__name__)

# Fallback tools used only when live discovery is unavailable
_KNOWN_TOOLS: dict[str, list[dict]] = {
    "slack": [
        {"name": "read_channel", "description": "Read messages from a Slack channel", "permission_level": "read", "input_schema": {}},
        {"name": "post_message", "description": "Post a message to a Slack channel", "permission_level": "write", "input_schema": {}},
        {"name": "delete_message", "description": "Delete a message the bot posted in a Slack channel", "permission_level": "destructive", "input_schema": {}},
    ],
}


@router.get("/servers", response_model=list[MCPServerResponse])
async def list_servers(db: AsyncSession = Depends(get_db)) -> list[MCPServerResponse]:
    servers = await svc.list_servers(db)
    return [MCPServerResponse.model_validate(s) for s in servers]


@router.post("/servers", response_model=MCPServerResponse, status_code=201)
async def register_server(
    body: MCPServerCreate, db: AsyncSession = Depends(get_db)
) -> MCPServerResponse:
    existing = await mcp_repo.get_server_by_name(db, body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Server '{body.name}' is already registered.")

    # Try live MCP discovery first; fall back to known tools list
    tools: list[dict] = []
    if body.token and body.transport == "http":
        try:
            tools = await svc.discover_tools_from_mcp(body.endpoint, body.token)
            logger.info("Discovered %d tools from %s", len(tools), body.endpoint)
        except Exception as exc:
            logger.warning("MCP discovery failed for %s: %s", body.endpoint, exc)

    if not tools:
        name_lower = body.name.lower()
        tools = next((t for key, t in _KNOWN_TOOLS.items() if key in name_lower), [])

    server = await mcp_repo.create_server(
        db,
        name=body.name,
        description=body.description,
        transport=body.transport,
        endpoint=body.endpoint,
        auth_type=body.auth_type,
        is_shared=body.is_shared,
        status="healthy",
    )

    for tool in tools:
        await mcp_repo.create_tool(db, mcp_server_id=server.id, **tool)

    await db.commit()
    refreshed = await mcp_repo.get_server_with_tools(db, server.id)
    return MCPServerResponse.model_validate(refreshed)


class SyncToolsRequest(BaseModel):
    token: str
    endpoint: str | None = None  # overrides the stored endpoint if provided


@router.post("/servers/{server_id}/sync-tools", response_model=MCPServerResponse)
async def sync_server_tools(
    server_id: uuid.UUID, body: SyncToolsRequest, db: AsyncSession = Depends(get_db)
) -> MCPServerResponse:
    """Re-discover tools from the live MCP endpoint and replace stored ones."""
    server = await mcp_repo.get_server_with_tools(db, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")

    endpoint = body.endpoint or server.endpoint
    try:
        tools = await svc.discover_tools_from_mcp(endpoint, body.token)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MCP discovery failed: {exc}") from exc

    # persist corrected endpoint if user supplied one
    if body.endpoint and body.endpoint != server.endpoint:
        server.endpoint = body.endpoint

    await mcp_repo.delete_server_tools(db, server_id)
    for tool in tools:
        await mcp_repo.create_tool(db, mcp_server_id=server_id, **tool)

    await db.commit()
    refreshed = await mcp_repo.get_server_with_tools(db, server_id)
    return MCPServerResponse.model_validate(refreshed)


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(
    server_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    server = await mcp_repo.get_server_with_tools(db, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    await db.delete(server)
    await db.commit()


@router.get("/servers/{server_id}/tools")
async def get_server_tools(
    server_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> list[dict]:
    tools = await svc.get_server_tools(db, server_id)
    return [
        {
            "id": str(t.id),
            "name": t.name,
            "description": t.description,
            "permission_level": t.permission_level,
            "input_schema": t.input_schema,
        }
        for t in tools
    ]


class DiscoveryToolEntry(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict = {}


class DiscoveryServerEntry(BaseModel):
    name: str
    endpoint: str
    transport: str = "http"


class ImportDiscoveryRequest(BaseModel):
    server: DiscoveryServerEntry
    tools: list[DiscoveryToolEntry]
    auth_type: str = "api_key"
    is_shared: bool = True


@router.post("/servers/import", response_model=MCPServerResponse, status_code=201)
async def import_discovery(
    body: ImportDiscoveryRequest, db: AsyncSession = Depends(get_db)
) -> MCPServerResponse:
    """Import a server + tools from a discovery JSON (e.g. output of mcp_slack_test.py).
    If the server already exists, its tools are replaced."""
    existing = await mcp_repo.get_server_by_name(db, body.server.name)

    if existing:
        server = existing
        server.endpoint = body.server.endpoint
        await mcp_repo.delete_server_tools(db, server.id)
    else:
        transport = body.server.transport
        if transport == "streamable-http":
            transport = "http"
        server = await mcp_repo.create_server(
            db,
            name=body.server.name,
            description=f"{body.server.name} MCP server",
            transport=transport,
            endpoint=body.server.endpoint,
            auth_type=body.auth_type,
            is_shared=body.is_shared,
            status="healthy",
        )

    for tool in body.tools:
        await mcp_repo.create_tool(
            db,
            mcp_server_id=server.id,
            name=tool.name,
            description=tool.description or "",
            input_schema=tool.input_schema,
            permission_level=svc._classify_permission(tool.name),
        )

    await db.commit()
    refreshed = await mcp_repo.get_server_with_tools(db, server.id)
    return MCPServerResponse.model_validate(refreshed)


@router.post("/seed", status_code=201)
async def seed_servers(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await svc.seed_mcp_data(db)
    return {"status": "seeded"}


@router.get("/tools/suggest", response_model=list[MCPServerResponse])
async def suggest_tools(prompt: str, db: AsyncSession = Depends(get_db)) -> list[MCPServerResponse]:
    servers = await svc.find_tools_for_prompt(db, prompt)
    return [MCPServerResponse.model_validate(s) for s in servers]
