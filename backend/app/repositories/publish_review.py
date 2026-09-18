import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.publish_review import PublishReview


async def get_active_review_for_agent(db: AsyncSession, agent_id: uuid.UUID) -> PublishReview | None:
    """A still-'pending' row already covers this agent — blocks a duplicate
    Publish while one is already parked awaiting a decision."""
    result = await db.execute(
        select(PublishReview).where(
            PublishReview.agent_id == agent_id, PublishReview.status == "pending"
        )
    )
    return result.scalar_one_or_none()


async def get_latest_review_for_agent(db: AsyncSession, agent_id: uuid.UUID) -> PublishReview | None:
    result = await db.execute(
        select(PublishReview)
        .where(PublishReview.agent_id == agent_id)
        .order_by(PublishReview.submitted_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_review(
    db: AsyncSession,
    agent_id: uuid.UUID,
    owner_id: uuid.UUID,
    thread_id: str,
    name: str,
    description: str,
    tools: list[dict[str, Any]],
    score: int,
    governance_grade: str,
    publisher_org: str,
    system_prompt: str,
    model_id: str,
    temperature: float,
) -> PublishReview:
    review = PublishReview(
        agent_id=agent_id,
        owner_id=owner_id,
        thread_id=thread_id,
        name=name,
        description=description,
        tools=tools,
        score=score,
        governance_grade=governance_grade,
        publisher_org=publisher_org,
        system_prompt=system_prompt,
        model_id=model_id,
        temperature=temperature,
        status="pending",
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return review


async def list_pending_reviews(db: AsyncSession) -> list[PublishReview]:
    result = await db.execute(
        select(PublishReview)
        .where(PublishReview.status == "pending")
        .order_by(PublishReview.submitted_at.asc())
    )
    return list(result.scalars().all())


async def get_review(db: AsyncSession, review_id: uuid.UUID) -> PublishReview | None:
    return await db.get(PublishReview, review_id)


async def mark_decided(
    db: AsyncSession, review_id: uuid.UUID, decision: str, notes: str | None
) -> PublishReview | None:
    """Only ever acts on a still-pending row — same race guard as the
    marketplace_listings decide flow."""
    review = await db.get(PublishReview, review_id)
    if review is None or review.status != "pending":
        return None
    review.status = decision
    review.review_notes = notes
    review.decided_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(review)
    return review
