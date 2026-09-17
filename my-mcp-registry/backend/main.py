import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.router import router as servers_router
from app.db import init_database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-registry")

app = FastAPI(
    title="My MCP Registry API",
    description="Dedicated SQL-driven MCP Server Registry & Client Exporter",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure database is initialized
init_database()

# Mount API router
app.include_router(servers_router)

# Health endpoint
@app.get("/health")
def health():
    return {"status": "ok", "service": "mcp-registry", "database": "sql"}

# Lightweight testing mock route for failure guard testing
@app.get("/mock/deadserver")
@app.post("/mock/deadserver")
def dead_server():
    raise HTTPException(status_code=503, detail="Dead Server Test Endpoint")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
