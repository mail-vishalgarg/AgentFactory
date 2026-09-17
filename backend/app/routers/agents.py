import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import agent_run as run_repo
from app.repositories import marketplace as marketplace_repo
from app.schemas.agent import (
    AgentConfigSchema,
    AgentCreate,
    AgentResponse,
    AgentRunRequest,
    AgentRunResponse,
    AgentScoreResponse,
    PublishResponse,
)
from app.services.agent_builder import build_agent_config, execute_agent
from app.services.github_tools import verify_github_token, verify_slack_token
from app.services.scoring import evaluate_publish_gate

router = APIRouter()


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(
    request: AgentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentResponse:
    config = await build_agent_config(db, request)
    config_dict = config.model_dump(mode="json")

    # Auto-populate credentials from this owner's existing agents for servers not provided
    credentials = dict(request.credentials or {})
    needed_servers = {t.mcp_server_name for t in config.tools}
    for server in needed_servers:
        already_have = any(server.lower() in k.lower() for k in credentials)
        if not already_have:
            existing_token = await agent_repo.get_reusable_token_for_server(db, user.id, server)
            if existing_token:
                credentials[server] = existing_token

    agent = await agent_repo.save_agent(
        db,
        owner_id=user.id,
        name=request.name,
        description=request.description,
        config_dict=config_dict,
        credentials=credentials,
    )
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        status=agent.status,
        config=config,
        created_at=agent.created_at,
        api_token=agent.api_token,
    )


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[AgentResponse]:
    agents = await agent_repo.list_agents(db, user.id)
    summaries = await run_repo.get_run_summaries_for_owner(db, user.id)
    responses = []
    for a in agents:
        summary = summaries.get(a.id)
        responses.append(
            AgentResponse(
                id=a.id,
                name=a.name,
                description=a.description,
                status=a.status,
                config=AgentConfigSchema.model_validate(a.config),
                created_at=a.created_at,
                api_token=a.api_token,
                run_count=summary.run_count if summary else 0,
                last_run_status=summary.last_status if summary else None,
                last_run_at=summary.last_ran_at if summary else None,
            )
        )
    return responses


@router.get("/credential-availability")
async def get_credential_availability(
    servers: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, dict]:
    """Check which servers already have tokens stored in one of THIS owner's agents."""
    server_list = [s.strip() for s in servers.split(",") if s.strip()]
    all_agents = await agent_repo.list_agents(db, user.id)
    result: dict[str, dict] = {}
    for server in server_list:
        found = any(
            any(
                server.lower() in k.lower() or k.lower() in server.lower()
                for k in (a.credentials or {})
            )
            for a in all_agents
        )
        result[server] = {"available": found}
    return result


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    summary = await run_repo.get_run_summary(db, agent_id)
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        status=agent.status,
        config=AgentConfigSchema.model_validate(agent.config),
        created_at=agent.created_at,
        api_token=agent.api_token,
        run_count=summary.run_count,
        last_run_status=summary.last_status,
        last_run_at=summary.last_ran_at,
    )


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    deleted = await agent_repo.delete_agent(db, agent_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent not found")


@router.get("/{agent_id}/score", response_model=AgentScoreResponse)
async def get_agent_score(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentScoreResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = AgentConfigSchema.model_validate(agent.config)
    run_count, ok_count = await run_repo.get_run_stats(db, agent_id)
    gate = evaluate_publish_gate(config, run_count, ok_count)
    listing = await marketplace_repo.get_latest_listing_for_agent(db, agent_id)

    return AgentScoreResponse(
        score=gate.score,
        score_ok=gate.score_ok,
        governance_grade=gate.governance,
        governance_ok=gate.governance_ok,
        write_tools_gated=gate.write_tools_gated,
        can_publish=gate.can_publish,
        blocked_reason=gate.blocked_reason,
        publish_status=listing.status if listing else None,
    )


@router.post("/{agent_id}/publish", response_model=PublishResponse)
async def publish_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublishResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = AgentConfigSchema.model_validate(agent.config)
    run_count, ok_count = await run_repo.get_run_stats(db, agent_id)
    gate = evaluate_publish_gate(config, run_count, ok_count)
    if not gate.can_publish:
        raise HTTPException(status_code=400, detail=gate.blocked_reason)

    # Sanitized design only: no credentials, no internal mcp_server_id.
    sanitized_tools = [
        {
            "mcp_server_name": t.mcp_server_name,
            "tool_name": t.tool_name,
            "tool_description": t.tool_description,
            "permission_level": t.permission_level,
        }
        for t in config.tools
    ]
    listing = await marketplace_repo.create_listing(
        db,
        agent_id=agent_id,
        publisher_owner_id=user.id,
        name=agent.name,
        description=agent.description,
        tools=sanitized_tools,
        score=gate.score,
        governance_grade=gate.governance,
    )
    return PublishResponse(listing_id=str(listing.id), status=listing.status)


@router.post("/{agent_id}/run", response_model=AgentRunResponse)
async def run_agent(
    agent_id: uuid.UUID,
    body: AgentRunRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentRunResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = AgentConfigSchema.model_validate(agent.config)
    start_time = time.monotonic()
    try:
        output = await execute_agent(config, credentials=agent.credentials or {}, message=body.message)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start_time) * 1000)
        cost_usd = latency_ms / 1000 * 0.004
        await run_repo.record_run(
            db, agent_id, trigger="Playground", status="error",
            latency_ms=latency_ms, cost_usd=cost_usd, result=str(exc)[:200],
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    latency_ms = int((time.monotonic() - start_time) * 1000)
    cost_usd = latency_ms / 1000 * 0.004
    await run_repo.record_run(
        db, agent_id, trigger="Playground", status="ok",
        latency_ms=latency_ms, cost_usd=cost_usd, result=str(output)[:200],
    )

    server_names = list({t.mcp_server_name for t in config.tools})
    await agent_repo.touch_server_last_used(db, agent_id, server_names)

    return AgentRunResponse(output=str(output), agent_id=str(agent_id))


@router.get("/{agent_id}/config")
async def get_agent_config(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent.config


class VerifyTokenRequest(BaseModel):
    server: str
    token: str


class VerifyTokenResponse(BaseModel):
    ok: bool
    message: str


@router.get("/{agent_id}/credential-status")
async def get_credential_status(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, dict]:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    last_used: dict = agent.server_last_used or {}
    result: dict[str, dict] = {}
    for key, token in (agent.credentials or {}).items():
        if "github" in key.lower():
            ok, msg = verify_github_token(token)
        elif "slack" in key.lower():
            ok, msg = verify_slack_token(token)
        else:
            ok, msg = True, "No verification available"
        # Key by the actual credential key (mcp_server_name) so the frontend can match it
        result[key] = {
            "ok": ok,
            "message": msg,
            "key": key,
            "last_used": last_used.get(key),
        }
    return result


class UpdateCredentialRequest(BaseModel):
    server: str
    token: str


@router.patch("/{agent_id}/credentials", response_model=VerifyTokenResponse)
async def update_agent_credentials(
    agent_id: uuid.UUID,
    body: UpdateCredentialRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> VerifyTokenResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    if "github" in body.server.lower():
        ok, msg = verify_github_token(body.token)
    elif "slack" in body.server.lower():
        ok, msg = verify_slack_token(body.token)
    else:
        ok, msg = True, f"{body.server} token accepted"

    if ok:
        await agent_repo.update_credentials(db, agent_id, body.server, body.token)

    return VerifyTokenResponse(ok=ok, message=msg)


@router.delete("/{agent_id}/credentials/{server}", status_code=204)
async def revoke_agent_credential(
    agent_id: uuid.UUID,
    server: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    creds = dict(agent.credentials or {})
    keys_to_remove = [k for k in creds if server.lower() in k.lower()]
    for k in keys_to_remove:
        del creds[k]
    agent.credentials = creds
    await db.commit()


@router.post("/verify-token", response_model=VerifyTokenResponse)
async def verify_token(
    body: VerifyTokenRequest, user: User = Depends(get_current_user)
) -> VerifyTokenResponse:
    if "github" in body.server.lower():
        ok, msg = verify_github_token(body.token)
        return VerifyTokenResponse(ok=ok, message=msg)
    if "slack" in body.server.lower():
        ok, msg = verify_slack_token(body.token)
        return VerifyTokenResponse(ok=ok, message=msg)
    return VerifyTokenResponse(ok=True, message=f"{body.server} token accepted")
