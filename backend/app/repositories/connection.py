from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connection import Connection


async def list_connections(db: AsyncSession) -> list[Connection]:
    result = await db.execute(select(Connection).order_by(Connection.created_at.desc()))
    return list(result.scalars().all())


async def get_connection(db: AsyncSession, server_name: str) -> Connection | None:
    result = await db.execute(select(Connection).where(Connection.server_name == server_name))
    return result.scalar_one_or_none()


async def upsert_connection(db: AsyncSession, server_name: str, token: str) -> Connection:
    existing = await get_connection(db, server_name)
    if existing:
        existing.token = token
        existing.status = "active"
        await db.flush()
        return existing
    conn = Connection(server_name=server_name, token=token, status="active")
    db.add(conn)
    await db.flush()
    return conn


async def revoke_connection(db: AsyncSession, server_name: str) -> bool:
    conn = await get_connection(db, server_name)
    if not conn:
        return False
    conn.status = "revoked"
    await db.flush()
    return True
