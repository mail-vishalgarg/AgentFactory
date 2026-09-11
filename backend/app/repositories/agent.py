import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent


async def save_agent(
    db: AsyncSession,
    name: str,
    description: str,
    config_dict: dict[str, Any],
    credentials: dict[str, str] | None = None,
) -> Agent:
    agent = Agent(name=name, description=description, config=config_dict, credentials=credentials or {}, api_token=str(uuid.uuid4()))
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


async def get_agent(db: AsyncSession, agent_id: uuid.UUID) -> Agent | None:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()


async def list_agents(db: AsyncSession) -> list[Agent]:
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    return list(result.scalars().all())


async def delete_agent(db: AsyncSession, agent_id: uuid.UUID) -> bool:
    agent = await get_agent(db, agent_id)
    if agent is None:
        return False
    await db.delete(agent)
    await db.commit()
    return True


async def update_credentials(
    db: AsyncSession, agent_id: uuid.UUID, server_key: str, token: str
) -> Agent | None:
    agent = await get_agent(db, agent_id)
    if agent is None:
        return None
    creds = dict(agent.credentials or {})
    creds[server_key] = token
    agent.credentials = creds
    await db.commit()
    await db.refresh(agent)
    return agent


async def touch_server_last_used(
    db: AsyncSession, agent_id: uuid.UUID, server_names: list[str]
) -> None:
    from datetime import timezone
    agent = await get_agent(db, agent_id)
    if agent is None:
        return
    now = datetime.now(timezone.utc).isoformat()
    last_used = dict(agent.server_last_used or {})
    for name in server_names:
        last_used[name] = now
    agent.server_last_used = last_used
    await db.commit()


async def get_reusable_token_for_server(db: AsyncSession, server_name: str) -> str | None:
    """Return the most recently updated token for a server from any existing agent."""
    agents = await list_agents(db)
    for agent in agents:
        creds = agent.credentials or {}
        # Match if either name contains the other (handles "github" ↔ "github_project")
        token = next(
            (v for k, v in creds.items()
             if server_name.lower() in k.lower() or k.lower() in server_name.lower()),
            None,
        )
        if token:
            return token
    return None


async def update_agent_status(db: AsyncSession, agent_id: uuid.UUID, status: str) -> Agent | None:
    agent = await get_agent(db, agent_id)
    if agent is None:
        return None
    agent.status = status
    await db.commit()
    await db.refresh(agent)
    return agent
