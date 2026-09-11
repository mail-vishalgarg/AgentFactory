import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.repositories import mcp as mcp_repo
from app.schemas.mcp import MCPServerCreate, MCPServerResponse
from app.services import mcp_registry as svc

router = APIRouter()

# Known tools to auto-register per server name when no real MCP discovery is available
_KNOWN_TOOLS: dict[str, list[dict]] = {
    "github": [
        {"name": "list_issues", "description": "List open issues in a repository", "permission_level": "read"},
        {"name": "get_issue", "description": "Get details of a specific issue", "permission_level": "read"},
        {"name": "get_last_commit", "description": "Get the most recent commit on a branch", "permission_level": "read"},
        {"name": "get_repositories", "description": "List repositories for a GitHub user or organisation", "permission_level": "read"},
    ],
    "slack": [
        {"name": "read_channel", "description": "Read messages from a Slack channel", "permission_level": "read"},
        {"name": "post_message", "description": "Post a message to a Slack channel", "permission_level": "write"},
        {"name": "delete_message", "description": "Delete a message the bot posted in a Slack channel", "permission_level": "destructive"},
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

    # auto-register known tools — match if any known key is a substring of the server name
    name_lower = body.name.lower()
    known = next((tools for key, tools in _KNOWN_TOOLS.items() if key in name_lower), [])
    for tool in known:
        await mcp_repo.create_tool(db, mcp_server_id=server.id, input_schema={}, **tool)

    await db.commit()
    await db.refresh(server)

    # reload with tools relationship
    refreshed = await mcp_repo.get_server_with_tools(db, server.id)
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


@router.post("/seed", status_code=201)
async def seed_servers(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await svc.seed_mcp_data(db)
    return {"status": "seeded"}


@router.get("/tools/suggest", response_model=list[MCPServerResponse])
async def suggest_tools(prompt: str, db: AsyncSession = Depends(get_db)) -> list[MCPServerResponse]:
    servers = await svc.find_tools_for_prompt(db, prompt)
    return [MCPServerResponse.model_validate(s) for s in servers]
