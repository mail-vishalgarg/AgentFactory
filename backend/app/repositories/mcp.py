import uuid

from sqlalchemy import select
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


async def list_all_servers(db: AsyncSession) -> list[MCPServer]:
    result = await db.execute(
        select(MCPServer).options(selectinload(MCPServer.tools)).order_by(MCPServer.name)
    )
    return list(result.scalars().all())


async def get_server_with_tools(db: AsyncSession, server_id: uuid.UUID) -> MCPServer | None:
    result = await db.execute(
        select(MCPServer)
        .where(MCPServer.id == server_id)
        .options(selectinload(MCPServer.tools))
    )
    return result.scalar_one_or_none()
