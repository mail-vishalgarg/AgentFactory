import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import agent_run as run_repo

router = APIRouter()


class RunResponse(BaseModel):
    id: str
    trigger: str
    status: str
    latency_ms: int
    cost_usd: float
    result: str
    ran_at: datetime


class RunWithAgentResponse(RunResponse):
    agent_id: str
    agent_name: str


@router.get("/{agent_id}/runs", response_model=list[RunResponse])
async def list_agent_runs(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RunResponse]:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    runs = await run_repo.list_runs(db, agent_id)
    return [
        RunResponse(
            id=str(r.id),
            trigger=r.trigger,
            status=r.status,
            latency_ms=r.latency_ms,
            cost_usd=float(r.cost_usd),
            result=r.result,
            ran_at=r.ran_at,
        )
        for r in runs
    ]


@router.get("/runs", response_model=list[RunWithAgentResponse])
async def list_all_runs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RunWithAgentResponse]:
    """All runs across every agent this user owns, newest first — backs the
    'Runs' tab on the My Agents page."""
    rows = await run_repo.list_runs_for_owner(db, user.id)
    return [
        RunWithAgentResponse(
            id=str(r.id),
            trigger=r.trigger,
            status=r.status,
            latency_ms=r.latency_ms,
            cost_usd=float(r.cost_usd),
            result=r.result,
            ran_at=r.ran_at,
            agent_id=str(r.agent_id),
            agent_name=agent_name,
        )
        for r, agent_name in rows
    ]
