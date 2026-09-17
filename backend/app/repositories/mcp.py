import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.mcp import MCPServer, MCPTool


async def get_server_by_name(db: AsyncSession, name: str) -> MCPServer | None:
    result = await db.execute(select(MCPServer).where(MCPServer.name == name))
    return result.scalar_one_or_none()


async def create_server(db: AsyncSession, **kwargs: object) -> MCPServer:
    server = MCPServer(**kwargs)
    db.add(server)
    await db.flush()
    return server


async def create_tool(db: AsyncSession, **kwargs: object) -> MCPTool:
    tool = MCPTool(**kwargs)
    db.add(tool)
    await db.flush()
    return tool


async def get_tools_by_ids(db: AsyncSession, ids: list[uuid.UUID]) -> list[MCPTool]:
    result = await db.execute(
        select(MCPTool).where(MCPTool.id.in_(ids)).options(selectinload(MCPTool.server))
    )
    return list(result.scalars().all())


async def list_visible_servers(db: AsyncSession, owner_id: uuid.UUID) -> list[MCPServer]:
    """Servers marked is_shared=True (visible to everyone) plus this owner's
    own private (is_shared=False) registrations — never another owner's
    private ones."""
    result = await db.execute(
        select(MCPServer)
        .where(or_(MCPServer.is_shared.is_(True), MCPServer.owner_id == owner_id))
        .options(selectinload(MCPServer.tools))
        .order_by(MCPServer.name)
    )
    return list(result.scalars().all())


async def delete_server_tools(db: AsyncSession, server_id: uuid.UUID) -> None:
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(MCPTool).where(MCPTool.mcp_server_id == server_id))
    await db.flush()


async def get_visible_tool_by_name(
    db: AsyncSession, server_name: str, tool_name: str, owner_id: uuid.UUID
) -> MCPTool | None:
    """A tool by (server name, tool name), scoped to servers this owner can
    actually see -- shared servers, or their own private registrations."""
    result = await db.execute(
        select(MCPTool)
        .join(MCPServer, MCPServer.id == MCPTool.mcp_server_id)
        .where(
            MCPServer.name == server_name,
            MCPTool.name == tool_name,
            or_(MCPServer.is_shared.is_(True), MCPServer.owner_id == owner_id),
        )
        .options(selectinload(MCPTool.server))
    )
    return result.scalar_one_or_none()


async def get_server_with_tools(db: AsyncSession, server_id: uuid.UUID) -> MCPServer | None:
    result = await db.execute(
        select(MCPServer)
        .where(MCPServer.id == server_id)
        .options(selectinload(MCPServer.tools))
    )
    return result.scalar_one_or_none()
