import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import agent_runs, agents, auth, connections, invoke, mcp_registry


app = FastAPI(
    title="AgentFactory",
    description="MCP Registry + Agent Builder API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(mcp_registry.router, prefix="/mcp", tags=["MCP Registry"])
app.include_router(agents.router, prefix="/agents", tags=["Agents"])
app.include_router(agent_runs.router, prefix="/agents", tags=["Runs"])
app.include_router(connections.router, prefix="/connections", tags=["Connections"])
app.include_router(invoke.router, tags=["Invoke"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
