from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import AsyncSessionLocal
from app.routers import agent_runs, agents, connections, invoke, mcp_registry
from app.services.mcp_registry import seed_mcp_data


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with AsyncSessionLocal() as db:
        try:
            await seed_mcp_data(db)
        except Exception:
            # DB may not be ready yet (first run before migration); skip seed
            pass
    yield


app = FastAPI(
    title="MVP AgentBuilder",
    description="MCP Registry + Agent Builder API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mcp_registry.router, prefix="/mcp", tags=["MCP Registry"])
app.include_router(agents.router, prefix="/agents", tags=["Agents"])
app.include_router(agent_runs.router, prefix="/agents", tags=["Runs"])
app.include_router(connections.router, prefix="/connections", tags=["Connections"])
app.include_router(invoke.router, tags=["Invoke"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
