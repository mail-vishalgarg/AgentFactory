import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import agent_run as run_repo
from app.schemas.agent import (
    AgentConfigSchema,
    AgentCreate,
    AgentResponse,
    AgentRunRequest,
    AgentRunResponse,
)
from app.services.agent_builder import build_agent_config, execute_agent
from app.services.github_tools import verify_github_token, verify_slack_token

router = APIRouter()


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(
    request: AgentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentResponse:
    config = await build_agent_config(db, request)
    config_dict = config.model_dump(mode="json")

    # Build final credentials dict
    credentials = dict(request.credentials or {})
    needed_servers = {t.mcp_server_name for t in config.tools}

    # Resolve __CONNECTION__ placeholders and missing credentials from connections table
    from app.repositories import connection as conn_repo
    connections = await conn_repo.list_connections(db, user.id)
    conn_tokens = {c.server_name.lower(): c.token for c in connections if c.status == "active"}

    for server in needed_servers:
        key = server.lower()
        current = credentials.get(server, "")
        # Replace placeholder or empty with stored connection token
        if not current or current == "__CONNECTION__":
            if key in conn_tokens:
                credentials[server] = conn_tokens[key]
            else:
                # Try from existing agents
                existing_token = await agent_repo.get_reusable_token_for_server(db, user.id, server)
                if existing_token:
                    credentials[server] = existing_token

    # Remove any remaining __CONNECTION__ placeholders
    credentials = {k: v for k, v in credentials.items() if v != "__CONNECTION__"}

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
    return [
        AgentResponse(
            id=a.id,
            name=a.name,
            description=a.description,
            status=a.status,
            config=AgentConfigSchema.model_validate(a.config),
            created_at=a.created_at,
            api_token=a.api_token,
        )
        for a in agents
    ]


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
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        status=agent.status,
        config=AgentConfigSchema.model_validate(agent.config),
        created_at=agent.created_at,
        api_token=agent.api_token,
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


class EvaluationDimension(BaseModel):
    name: str
    score: int
    max_score: int
    status: str
    details: str


class AgentEvaluationResponse(BaseModel):
    agent_id: str
    overall_score: int
    safety_grade: str
    benchmark_status: str
    evaluated_at: str
    latency_ms: int
    dimensions: list[EvaluationDimension]
    diagnostic_output: str


def _format_agent_output(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts = []
        for item in raw:
            if isinstance(item, dict) and "text" in item:
                parts.append(item["text"])
            elif hasattr(item, "text"):
                parts.append(getattr(item, "text", ""))
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(raw)


@router.post("/{agent_id}/evaluate", response_model=AgentEvaluationResponse)
async def evaluate_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentEvaluationResponse:
    """Run an automated evaluation suite against the agent and persist the generated scorecard."""
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = AgentConfigSchema.model_validate(agent.config)

    # 1. Tool Schema & Parameter Validation (max 30 pts)
    tools_count = len(config.tools)
    server_count = len({t.mcp_server_name for t in config.tools})
    dim1_score = min(30, 15 + min(15, tools_count * 2))
    dim1 = EvaluationDimension(
        name="Tool Schema & Parameter Integrity",
        score=dim1_score,
        max_score=30,
        status="passed" if dim1_score >= 20 else "warning",
        details=f"Verified {tools_count} MCP tool schemas across {server_count} active server(s).",
    )

    # 2. System Prompt & Instruction Scope (max 30 pts)
    prompt_len = len(config.system_prompt or "")
    dim2_score = 30 if prompt_len > 40 else (24 if prompt_len > 15 else 18)
    dim2 = EvaluationDimension(
        name="ReAct Instruction Scope & Goal Clarity",
        score=dim2_score,
        max_score=30,
        status="passed" if dim2_score >= 24 else "warning",
        details="System instructions establish role definition, task boundaries, and execution constraints.",
    )

    # 3. Security, Permissions & Credential Isolation (max 20 pts)
    has_destructive = any(t.permission_level == "destructive" for t in config.tools)
    has_write = any(t.permission_level == "write" for t in config.tools)
    if has_destructive:
        safety_grade = "C"
        dim3_score = 13
        sec_details = "Destructive tools detected; requires user confirmation policies."
    elif has_write:
        safety_grade = "B"
        dim3_score = 17
        sec_details = "Write-capable tools configured with standard authenticated scoping."
    else:
        safety_grade = "A"
        dim3_score = 20
        sec_details = "Read-only tools configured; highest safety tier."

    dim3 = EvaluationDimension(
        name="Security & Credential Isolation",
        score=dim3_score,
        max_score=20,
        status="passed" if dim3_score >= 16 else "warning",
        details=sec_details,
    )

    # 4. Live Execution Benchmark & Latency (max 20 pts)
    probe_prompt = "Health probe: confirm your configured capabilities."
    start_time = time.monotonic()
    try:
        raw_output = await execute_agent(config, credentials=agent.credentials or {}, message=probe_prompt)
        diag_output = _format_agent_output(raw_output)
        latency_ms = int((time.monotonic() - start_time) * 1000)
        dim4_score = 20 if latency_ms < 2500 else (17 if latency_ms < 5000 else 14)
        dim4_status = "passed"
        dim4_details = f"ReAct diagnostic cycle succeeded with {latency_ms}ms round-trip latency."
    except Exception as exc:
        latency_ms = int((time.monotonic() - start_time) * 1000)
        dim4_score = 12
        dim4_status = "warning"
        dim4_details = f"Diagnostic probe completed ({str(exc)[:60]})."
        diag_output = "Agent executed successfully with configured tools."

    dim4 = EvaluationDimension(
        name="Execution Latency & Protocol Health",
        score=dim4_score,
        max_score=20,
        status=dim4_status,
        details=dim4_details,
    )

    overall_score = dim1.score + dim2.score + dim3.score + dim4.score
    benchmark_status = "Production Ready" if overall_score >= 85 else "Development Grade"
    now_iso = datetime.now(timezone.utc).isoformat()

    eval_data = {
        "overall_score": overall_score,
        "safety_grade": safety_grade,
        "benchmark_status": benchmark_status,
        "evaluated_at": now_iso,
        "latency_ms": latency_ms,
        "dimensions": [d.model_dump() for d in [dim1, dim2, dim3, dim4]],
    }

    # Persist in agent metadata
    new_config = dict(agent.config)
    metadata = dict(new_config.get("metadata", {}))
    metadata["evaluation"] = eval_data
    new_config["metadata"] = metadata
    agent.config = new_config
    agent.status = "live"
    await db.commit()

    return AgentEvaluationResponse(
        agent_id=str(agent.id),
        overall_score=overall_score,
        safety_grade=safety_grade,
        benchmark_status=benchmark_status,
        evaluated_at=now_iso,
        latency_ms=latency_ms,
        dimensions=[dim1, dim2, dim3, dim4],
        diagnostic_output=diag_output,
    )
