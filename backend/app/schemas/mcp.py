import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MCPToolResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    mcp_server_id: uuid.UUID
    name: str
    description: str
    input_schema: dict
    permission_level: str
    created_at: datetime


class MCPServerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    transport: str
    endpoint: str
    auth_type: str
    status: str
    is_shared: bool
    last_checked_at: datetime | None
    created_at: datetime
    tools: list[MCPToolResponse] = []


class MCPServerCreate(BaseModel):
    name: str
    description: str
    transport: str
    endpoint: str
    auth_type: str
    is_shared: bool = True
    token: str | None = None
