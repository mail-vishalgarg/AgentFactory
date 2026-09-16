import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.agent_run import AgentRun


@dataclass
class RunSummary:
    run_count: int
    last_status: str | None
    last_ran_at: datetime | None


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


async def list_runs_for_owner(
    db: AsyncSession, owner_id: uuid.UUID, limit: int = 100
) -> list[tuple[AgentRun, str]]:
    """All runs across every agent this owner has, newest first, paired with
    each run's agent name so the caller doesn't need a second lookup."""
    result = await db.execute(
        select(AgentRun, Agent.name)
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(Agent.owner_id == owner_id)
        .order_by(AgentRun.ran_at.desc())
        .limit(limit)
    )
    return [(run, name) for run, name in result.all()]


async def get_run_summary(db: AsyncSession, agent_id: uuid.UUID) -> RunSummary:
    """Run count + most recent run's status/timestamp for a single agent."""
    count_result = await db.execute(
        select(func.count()).select_from(AgentRun).where(AgentRun.agent_id == agent_id)
    )
    latest_result = await db.execute(
        select(AgentRun.status, AgentRun.ran_at)
        .where(AgentRun.agent_id == agent_id)
        .order_by(AgentRun.ran_at.desc())
        .limit(1)
    )
    latest = latest_result.first()
    return RunSummary(
        run_count=count_result.scalar_one(),
        last_status=latest.status if latest else None,
        last_ran_at=latest.ran_at if latest else None,
    )


async def get_run_summaries_for_owner(
    db: AsyncSession, owner_id: uuid.UUID
) -> dict[uuid.UUID, RunSummary]:
    """Run count + most recent run's status/timestamp per agent, for every
    agent this owner has — one round trip for the My Agents card list."""
    counts = await db.execute(
        select(AgentRun.agent_id, func.count().label("run_count"))
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(Agent.owner_id == owner_id)
        .group_by(AgentRun.agent_id)
    )
    count_map = {row.agent_id: row.run_count for row in counts}

    latest = await db.execute(
        select(AgentRun.agent_id, AgentRun.status, AgentRun.ran_at)
        .distinct(AgentRun.agent_id)
        .join(Agent, Agent.id == AgentRun.agent_id)
        .where(Agent.owner_id == owner_id)
        .order_by(AgentRun.agent_id, AgentRun.ran_at.desc())
    )
    return {
        row.agent_id: RunSummary(
            run_count=count_map.get(row.agent_id, 0),
            last_status=row.status,
            last_ran_at=row.ran_at,
        )
        for row in latest
    }
