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
from app.repositories import connection as conn_repo
from app.repositories import mcp as mcp_repo
from app.repositories import publish_review as publish_review_repo
from app.schemas.agent import (
    AgentConfigSchema,
    AgentCreate,
    AgentResponse,
    AgentRunRequest,
    AgentRunResponse,
    AgentScoreResponse,
    ChecklistItemResponse,
    GovernanceBreakdownResponse,
    PublishResponse,
    ScoreBreakdownResponse,
)
from app.services.agent_builder import build_agent_config, execute_agent, resume_agent as _resume_agent
from app.services.github_tools import verify_pat_token
from app.services.publish_graph import get_publish_graph
from app.services.scoring import build_trust_checklist, evaluate_publish_gate

router = APIRouter()


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(
    request: AgentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentResponse:
    existing = await agent_repo.get_agent_by_name(db, user.id, request.name)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"You already have an agent named '{request.name}'. Please choose a different name.",
        )

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
    review = await publish_review_repo.get_latest_review_for_agent(db, agent_id)

    server_statuses: dict[str, str] = {}
    for server_id in {t.mcp_server_id for t in config.tools}:
        try:
            server = await mcp_repo.get_server_with_tools(db, uuid.UUID(server_id))
        except ValueError:
            server = None
        server_statuses[server_id] = server.status if server else "dead"

    checklist = build_trust_checklist(config, agent.credentials or {}, server_statuses, run_count)

    return AgentScoreResponse(
        score=gate.score,
        score_ok=gate.score_ok,
        governance_grade=gate.governance,
        governance_ok=gate.governance_ok,
        write_tools_gated=gate.write_tools_gated,
        can_publish=gate.can_publish,
        blocked_reason=gate.blocked_reason,
        publish_status=review.status if review else None,
        review_notes=review.review_notes if review else None,
        reviewed_at=review.decided_at if review else None,
        breakdown=ScoreBreakdownResponse(
            reliability=gate.breakdown.reliability,
            scope=gate.breakdown.scope,
            coverage=gate.breakdown.coverage,
            completeness=gate.breakdown.completeness,
            run_count=gate.run_count,
            ok_count=gate.ok_count,
            tool_count=len(config.tools),
        ),
        governance_detail=GovernanceBreakdownResponse(
            grade=gate.governance_detail.grade,
            read_only_count=gate.governance_detail.read_only_count,
            total_tools=gate.governance_detail.total_tools,
            read_only_ratio=gate.governance_detail.read_only_ratio,
            capped_for_destructive_scope=gate.governance_detail.capped_for_destructive_scope,
        ),
        checklist=[ChecklistItemResponse(label=c.label, ok=c.ok, detail=c.detail) for c in checklist],
    )


@router.post("/{agent_id}/publish", response_model=PublishResponse)
async def publish_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublishResponse:
    """Starts a real, durable LangGraph run that pauses immediately and waits
    for an admin — possibly for days, across restarts (Postgres-backed
    checkpointer, not in-memory). See services/publish_graph.py."""
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    existing = await publish_review_repo.get_active_review_for_agent(db, agent_id)
    if existing is not None:
        raise HTTPException(
            status_code=400,
            detail="This agent already has a submission awaiting admin review.",
        )

    config = AgentConfigSchema.model_validate(agent.config)
    run_count, ok_count = await run_repo.get_run_stats(db, agent_id)
    gate = evaluate_publish_gate(config, run_count, ok_count)
    if not gate.can_publish:
        raise HTTPException(status_code=400, detail=gate.blocked_reason)

    # Sanitized design only: no credentials, no internal mcp_server_id, no
    # publisher identity beyond an org label derived from their email domain.
    sanitized_tools = [
        {
            "mcp_server_name": t.mcp_server_name,
            "tool_name": t.tool_name,
            "tool_description": t.tool_description,
            "permission_level": t.permission_level,
            "requires_approval": t.requires_approval,
        }
        for t in config.tools
    ]
    publisher_org = user.email.split("@")[-1] if "@" in user.email else "unknown"

    thread_id = str(uuid.uuid4())
    graph = get_publish_graph()
    await graph.ainvoke(
        {
            "agent_id": str(agent_id),
            "name": agent.name,
            "score": gate.score,
            "governance_grade": gate.governance,
            "decision": None,
            "notes": None,
        },
        config={"configurable": {"thread_id": thread_id}},
    )
    # ainvoke returns as soon as the graph's one node hits interrupt() —
    # execution genuinely paused here, checkpointed to Postgres.

    review = await publish_review_repo.create_review(
        db,
        agent_id=agent_id,
        owner_id=user.id,
        thread_id=thread_id,
        name=agent.name,
        description=agent.description,
        tools=sanitized_tools,
        score=gate.score,
        governance_grade=gate.governance,
        publisher_org=publisher_org,
        system_prompt=config.system_prompt,
        model_id=config.model.model_id,
        temperature=config.model.temperature,
    )
    return PublishResponse(listing_id=str(review.id), status=review.status)


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
    connections = await conn_repo.list_connections(db, user.id)
    conn_creds = {c.server_name.lower(): c.token for c in connections if c.status == "active"}
    active_credentials = {**conn_creds, **(agent.credentials or {})}
    start_time = time.monotonic()
    try:
        result = await execute_agent(config, credentials=active_credentials, message=body.message)
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
    run_status = "approval" if result.status == "pending_approval" else "ok"
    await run_repo.record_run(
        db, agent_id, trigger="Playground", status=run_status,
        latency_ms=latency_ms, cost_usd=cost_usd, result=result.output[:200],
    )

    server_names = list({t.mcp_server_name for t in config.tools})
    await agent_repo.touch_server_last_used(db, agent_id, server_names)

    return AgentRunResponse(
        output=result.output,
        agent_id=str(agent_id),
        status=result.status,
        thread_id=result.thread_id,
        pending_tool_name=result.pending_tool_name,
        pending_tool_args=result.pending_tool_args,
    )


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
        ok, msg = verify_pat_token(key, token)
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

    ok, msg = verify_pat_token(body.server, body.token)

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


class ResumeRequest(BaseModel):
    thread_id: str
    approved: bool


@router.post("/{agent_id}/resume", response_model=AgentRunResponse)
async def resume_agent_run(
    agent_id: uuid.UUID,
    body: ResumeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentRunResponse:
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    result = await _resume_agent(body.thread_id, body.approved)
    action = "approved" if body.approved else "rejected"
    run_status = "ok" if result.status != "pending_approval" else "approval"
    await run_repo.record_run(
        db, agent_id, trigger="Playground", status=run_status,
        latency_ms=0, cost_usd=0.0, result=f"[{action}] {result.output[:180]}",
    )
    return AgentRunResponse(
        output=result.output,
        agent_id=str(agent_id),
        status=result.status,
        thread_id=result.thread_id,
        pending_tool_name=result.pending_tool_name,
        pending_tool_args=result.pending_tool_args,
    )


@router.post("/verify-token", response_model=VerifyTokenResponse)
async def verify_token(
    body: VerifyTokenRequest, user: User = Depends(get_current_user)
) -> VerifyTokenResponse:
    ok, msg = verify_pat_token(body.server, body.token)
    return VerifyTokenResponse(ok=ok, message=msg)


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
    """Runs the same publish-gate scoring used by /score, plus a live health
    probe. Kept in sync with GET /{agent_id}/score on purpose: this and the
    Settings tab must always show the same score and governance grade for
    the same agent."""
    agent = await agent_repo.get_agent_for_owner(db, agent_id, user.id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = AgentConfigSchema.model_validate(agent.config)
    run_count, ok_count = await run_repo.get_run_stats(db, agent_id)
    gate = evaluate_publish_gate(config, run_count, ok_count)
    b = gate.breakdown

    dimensions = [
        EvaluationDimension(
            name="Reliability",
            score=b.reliability,
            max_score=40,
            status="passed" if b.reliability >= 28 else "warning",
            details=(
                "No runs yet." if run_count == 0
                else f"{ok_count}/{run_count} run(s) succeeded"
                + (" — scaled down for a small sample (full credit needs 5+ runs)." if run_count < 5 else ".")
            ),
        ),
        EvaluationDimension(
            name="Scope",
            score=b.scope,
            max_score=30,
            status="passed" if b.scope >= 15 else "warning",
            details=f"{len(config.tools)} tool(s) attached — fewer tools scores higher, and write/destructive tools cost more than read-only ones.",
        ),
        EvaluationDimension(
            name="Coverage",
            score=b.coverage,
            max_score=15,
            status="passed" if b.coverage >= 10 else "warning",
            details=(
                "No runs yet." if run_count == 0
                else f"Weighted by the {round(ok_count / run_count * 100)}% of runs that actually succeeded."
            ),
        ),
        EvaluationDimension(
            name="Completeness",
            score=b.completeness,
            max_score=15,
            status="passed" if b.completeness >= 10 else "warning",
            details="Description, system prompt, and having at least one tool — 5 points each.",
        ),
    ]

    # Live health probe — informational only; it does NOT feed the score,
    # so a flaky live call can never make this disagree with /score.
    probe_prompt = "Health probe: confirm your configured capabilities."
    start_time = time.monotonic()
    try:
        run_result = await execute_agent(config, credentials=agent.credentials or {}, message=probe_prompt)
        diag_output = _format_agent_output(run_result.output)
        latency_ms = int((time.monotonic() - start_time) * 1000)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start_time) * 1000)
        diag_output = f"Live probe failed: {str(exc)[:200]}"

    overall_score = gate.score
    safety_grade = gate.governance
    benchmark_status = "Production Ready" if gate.can_publish else "Development Grade"
    now_iso = datetime.now(timezone.utc).isoformat()

    eval_data = {
        "overall_score": overall_score,
        "safety_grade": safety_grade,
        "benchmark_status": benchmark_status,
        "evaluated_at": now_iso,
        "latency_ms": latency_ms,
        "dimensions": [d.model_dump() for d in dimensions],
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
        dimensions=dimensions,
        diagnostic_output=diag_output,
    )
