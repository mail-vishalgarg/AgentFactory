import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connection import Connection


async def list_connections(db: AsyncSession, owner_id: uuid.UUID) -> list[Connection]:
    result = await db.execute(
        select(Connection).where(Connection.owner_id == owner_id).order_by(Connection.created_at.desc())
    )
    return list(result.scalars().all())


async def get_connection(db: AsyncSession, owner_id: uuid.UUID, server_name: str) -> Connection | None:
    result = await db.execute(
        select(Connection).where(Connection.owner_id == owner_id, Connection.server_name == server_name)
    )
    return result.scalar_one_or_none()


async def upsert_connection(db: AsyncSession, owner_id: uuid.UUID, server_name: str, token: str) -> Connection:
    existing = await get_connection(db, owner_id, server_name)
    if existing:
        existing.token = token
        existing.status = "active"
        await db.flush()
        return existing
    conn = Connection(owner_id=owner_id, server_name=server_name, token=token, status="active")
    db.add(conn)
    await db.flush()
    return conn


async def revoke_connection(db: AsyncSession, owner_id: uuid.UUID, server_name: str) -> bool:
    conn = await get_connection(db, owner_id, server_name)
    if not conn:
        return False
    conn.status = "revoked"
    await db.flush()
    return True
