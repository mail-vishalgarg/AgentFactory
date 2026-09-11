import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentRun


async def record_run(
    db: AsyncSession,
    agent_id: uuid.UUID,
    trigger: str,
    status: str,
    latency_ms: int,
    cost_usd: float,
    result: str,
) -> AgentRun:
    run = AgentRun(
        agent_id=agent_id,
        trigger=trigger,
        status=status,
        latency_ms=latency_ms,
        cost_usd=cost_usd,
        result=result,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def list_runs(db: AsyncSession, agent_id: uuid.UUID, limit: int = 50) -> list[AgentRun]:
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.agent_id == agent_id)
        .order_by(AgentRun.ran_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
