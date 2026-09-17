import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db import engine
from app.routers import agent_runs, agents, auth, connections, invoke, marketplace, mcp_registry

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS server_last_used JSONB NOT NULL DEFAULT '{}';")
            )
    except Exception as exc:
        logger.warning("Could not auto-migrate server_last_used column: %s", exc)
    yield


app = FastAPI(
    title="AgentFactory",
    description="MCP Registry + Agent Builder API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(mcp_registry.router, prefix="/mcp", tags=["MCP Registry"])
app.include_router(agent_runs.router, prefix="/agents", tags=["Runs"])
app.include_router(agents.router, prefix="/agents", tags=["Agents"])
app.include_router(connections.router, prefix="/connections", tags=["Connections"])
app.include_router(marketplace.router, prefix="/marketplace", tags=["Marketplace"])
app.include_router(invoke.router, tags=["Invoke"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {exc}"},
    )
