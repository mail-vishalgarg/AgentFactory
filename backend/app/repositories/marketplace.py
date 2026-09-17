import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.marketplace_listing import MarketplaceListing


async def create_listing(
    db: AsyncSession,
    agent_id: uuid.UUID,
    publisher_owner_id: uuid.UUID,
    name: str,
    description: str,
    tools: list[dict[str, Any]],
    score: int,
    governance_grade: str,
) -> MarketplaceListing:
    listing = MarketplaceListing(
        agent_id=agent_id,
        publisher_owner_id=publisher_owner_id,
        name=name,
        description=description,
        tools=tools,
        score=score,
        governance_grade=governance_grade,
        status="pending",
    )
    db.add(listing)
    await db.commit()
    await db.refresh(listing)
    return listing


async def get_latest_listing_for_agent(
    db: AsyncSession, agent_id: uuid.UUID
) -> MarketplaceListing | None:
    result = await db.execute(
        select(MarketplaceListing)
        .where(MarketplaceListing.agent_id == agent_id)
        .order_by(MarketplaceListing.submitted_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
