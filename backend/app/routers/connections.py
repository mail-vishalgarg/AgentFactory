from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import connection as conn_repo
from app.services.github_tools import verify_github_token, verify_slack_token

router = APIRouter()


class ConnectionCreate(BaseModel):
    server_name: str
    token: str


class ConnectionResponse(BaseModel):
    server_name: str
    status: str
    created_at: datetime
    last_used_at: datetime | None = None


@router.get("", response_model=list[ConnectionResponse])
async def list_connections(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[ConnectionResponse]:
    connections = await conn_repo.list_connections(db, user.id)
    return [
        ConnectionResponse(
            server_name=c.server_name,
            status=c.status,
            created_at=c.created_at,
            last_used_at=c.last_used_at,
        )
        for c in connections
    ]


@router.post("", response_model=ConnectionResponse, status_code=201)
async def add_connection(
    body: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConnectionResponse:
    if "github" in body.server_name.lower():
        ok, msg = verify_github_token(body.token)
    elif "slack" in body.server_name.lower():
        ok, msg = verify_slack_token(body.token)
    else:
        ok, msg = True, "Token accepted"

    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    conn = await conn_repo.upsert_connection(db, user.id, body.server_name, body.token)

    agents = await agent_repo.list_agents(db, user.id)
    for agent in agents:
        creds = agent.credentials or {}
        has_server = any(
            body.server_name.lower() in k.lower() or k.lower() in body.server_name.lower()
            for k in creds
        )
        if has_server:
            await agent_repo.update_credentials(db, agent.id, body.server_name, body.token)

    await db.commit()
    await db.refresh(conn)

    return ConnectionResponse(
        server_name=conn.server_name,
        status=conn.status,
        created_at=conn.created_at,
        last_used_at=conn.last_used_at,
    )


@router.delete("/{server_name}", status_code=204)
async def revoke_connection(
    server_name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    revoked = await conn_repo.revoke_connection(db, user.id, server_name)
    if not revoked:
        raise HTTPException(status_code=404, detail="Connection not found")

    agents = await agent_repo.list_agents(db, user.id)
    for agent in agents:
        creds = dict(agent.credentials or {})
        keys_to_remove = [
            k for k in creds
            if server_name.lower() in k.lower() or k.lower() in server_name.lower()
        ]
        if keys_to_remove:
            for k in keys_to_remove:
                del creds[k]
            agent.credentials = creds

    await db.commit()
    return Response(status_code=204)
