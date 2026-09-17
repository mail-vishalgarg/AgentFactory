import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.marketplace_listing import MarketplaceListing


async def create_listing(
    db: AsyncSession,
    agent_id: uuid.UUID,
    publisher_owner_id: uuid.UUID,
    publisher_org: str,
    name: str,
    description: str,
    system_prompt: str,
    model_id: str,
    temperature: float,
    tools: list[dict[str, Any]],
    score: int,
    governance_grade: str,
) -> MarketplaceListing:
    listing = MarketplaceListing(
        agent_id=agent_id,
        publisher_owner_id=publisher_owner_id,
        publisher_org=publisher_org,
        name=name,
        description=description,
        system_prompt=system_prompt,
        model_id=model_id,
        temperature=temperature,
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


async def list_approved_listings(db: AsyncSession) -> list[MarketplaceListing]:
    result = await db.execute(
        select(MarketplaceListing)
        .where(MarketplaceListing.status == "approved")
        .order_by(MarketplaceListing.submitted_at.desc())
    )
    return list(result.scalars().all())


async def get_approved_listing(db: AsyncSession, listing_id: uuid.UUID) -> MarketplaceListing | None:
    result = await db.execute(
        select(MarketplaceListing).where(
            MarketplaceListing.id == listing_id, MarketplaceListing.status == "approved"
        )
    )
    return result.scalar_one_or_none()


async def increment_install_count(db: AsyncSession, listing_id: uuid.UUID) -> None:
    listing = await db.get(MarketplaceListing, listing_id)
    if listing is not None:
        listing.install_count += 1
        await db.commit()
