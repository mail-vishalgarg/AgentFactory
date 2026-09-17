import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ModelConfig(BaseModel):
    provider: str = "openai"
    model_id: str = "gpt-4o-mini"
    temperature: float = 0.0
    max_tokens: int = 4096


class ToolConfig(BaseModel):
    mcp_server_id: str
    mcp_server_name: str
    tool_name: str
    tool_description: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    permission_level: str
    requires_approval: bool = False


class GraphConfig(BaseModel):
    type: Literal["react_agent"] = "react_agent"
    checkpointer: bool = False


class AgentConfigSchema(BaseModel):
    version: str = "1.0"
    agent_id: str
    name: str
    description: str
    created_at: str
    model: ModelConfig
    system_prompt: str
    tools: list[ToolConfig]
    graph: GraphConfig
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentCreate(BaseModel):
    name: str
    description: str
    system_prompt: str = "You are a helpful assistant."
    model_id: str = "gpt-4o-mini"
    temperature: float = 0.0
    tool_ids: list[uuid.UUID]
    user_prompt: str = ""
    # server_name → token; stored separately, never returned in responses
    credentials: dict[str, str] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    status: str
    config: AgentConfigSchema
    created_at: datetime
    api_token: str = ""
    run_count: int = 0
    last_run_status: str | None = None
    last_run_at: datetime | None = None


class AgentScoreResponse(BaseModel):
    score: int
    score_ok: bool
    governance_grade: str
    governance_ok: bool
    write_tools_gated: bool
    can_publish: bool
    blocked_reason: str | None
    publish_status: str | None


class PublishResponse(BaseModel):
    listing_id: str
    status: str


class AgentRunRequest(BaseModel):
    message: str


class AgentRunResponse(BaseModel):
    output: str
    agent_id: str
