from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import connection as conn_repo
from app.repositories import mcp as mcp_repo
from app.services.github_tools import verify_pat_token

router = APIRouter()


class ConnectionCreate(BaseModel):
    server_name: str
    token: str


class ConnectionResponse(BaseModel):
    server_name: str
    status: str
    created_at: datetime | None = None
    last_used_at: datetime | None = None
    message: str | None = None
    verified: bool = True


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
@router.post("/", response_model=ConnectionResponse, status_code=201)
async def add_connection(
    body: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConnectionResponse:
    # Clean accidental unicode/zero-width spaces or surrounding quotes
    cleaned_token = "".join(c for c in body.token if 32 <= ord(c) <= 126).strip().strip("\"'")
    if not cleaned_token:
        raise HTTPException(status_code=400, detail="Token cannot be empty or contain only invalid characters.")

    norm_server = body.server_name.strip().lower()

    # Find server endpoint if registered
    endpoint = ""
    server_obj = await mcp_repo.get_server_by_name(db, norm_server)
    if server_obj:
        endpoint = server_obj.endpoint or ""

    # Perform strict token verification
    ok, verify_msg = verify_pat_token(norm_server, cleaned_token, endpoint)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail=f"Verification failed: {verify_msg}",
        )

    try:
        conn = await conn_repo.upsert_connection(db, user.id, norm_server, cleaned_token)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database save error: {exc}")

    try:
        agents = await agent_repo.list_agents(db, user.id)
        for agent in agents:
            creds = agent.credentials or {}
            has_server = any(
                norm_server in k.lower() or k.lower() in norm_server
                for k in creds
            )
            if has_server:
                await agent_repo.update_credentials(db, agent.id, norm_server, cleaned_token)
    except Exception:
        pass

    return ConnectionResponse(
        server_name=conn.server_name,
        status=conn.status,
        created_at=conn.created_at or datetime.utcnow(),
        last_used_at=conn.last_used_at,
        message=verify_msg,
        verified=True,
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
