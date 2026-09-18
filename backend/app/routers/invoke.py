import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.repositories import agent as agent_repo
from app.repositories import agent_run as run_repo
from app.schemas.agent import AgentConfigSchema
from app.services.agent_builder import execute_agent

router = APIRouter()


class InvokeRequest(BaseModel):
    input: str


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Not found")


async def _resolve_agent(
    agent_id: uuid.UUID,
    authorization: str | None,
    db: AsyncSession,
):
    if not authorization or not authorization.startswith("Bearer "):
        raise _not_found()
    token = authorization.removeprefix("Bearer ").strip()
    agent = await agent_repo.get_agent(db, agent_id)
    if agent is None or agent.api_token != token:
        raise _not_found()
    return agent


@router.post("/v1/agents/{agent_id}/invoke")
async def invoke_agent(
    agent_id: uuid.UUID,
    body: InvokeRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agent = await _resolve_agent(agent_id, authorization, db)
    config = AgentConfigSchema.model_validate(agent.config)
    start = time.monotonic()
    try:
        res = await execute_agent(config, credentials=agent.credentials or {}, message=body.input)
        output_text = res.output if hasattr(res, "output") else str(res)
        latency_ms = int((time.monotonic() - start) * 1000)
        cost_usd = latency_ms / 1000 * 0.004
        await run_repo.record_run(
            db, agent_id, trigger="API", status="ok",
            latency_ms=latency_ms, cost_usd=cost_usd,
            result=output_text[:200],
        )
        return {"output": output_text, "agent_id": str(agent_id)}
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        await run_repo.record_run(
            db, agent_id, trigger="API", status="error",
            latency_ms=latency_ms, cost_usd=0.0,
            result=str(exc)[:200],
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/v1/agents/{agent_id}/postman")
async def get_postman_collection(
    agent_id: uuid.UUID,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    agent = await _resolve_agent(agent_id, authorization, db)
    aid = str(agent_id)
    collection = {
        "info": {
            "name": f"{agent.name} — Forge Agent",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "item": [
            {
                "name": "Invoke agent",
                "request": {
                    "method": "POST",
                    "header": [
                        {"key": "Authorization", "value": "Bearer {{AGENT_FACTORY}}"},
                        {"key": "Content-Type", "value": "application/json"},
                    ],
                    "body": {
                        "mode": "raw",
                        "raw": '{"input": "Your message here"}',
                        "options": {"raw": {"language": "json"}},
                    },
                    "url": {
                        "raw": f"{{{{base_url}}}}/v1/agents/{aid}/invoke",
                        "host": ["{{base_url}}"],
                        "path": ["v1", "agents", aid, "invoke"],
                    },
                },
            }
        ],
        "variable": [
            {"key": "base_url", "value": "http://localhost:8000"},
            {"key": "AGENT_FACTORY", "value": agent.api_token},
        ],
    }
    safe_name = agent.name.replace(" ", "_").lower()
    return JSONResponse(
        content=collection,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_collection.json"'},
    )
