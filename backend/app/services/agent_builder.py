from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.repositories import mcp as mcp_repo
from app.schemas.agent import AgentConfigSchema, AgentCreate, GraphConfig, ModelConfig, ToolConfig
from app.services.github_tools import make_github_tools, make_placeholder_tool, make_slack_tools


async def build_agent_config(db: AsyncSession, request: AgentCreate) -> AgentConfigSchema:
    tools = await mcp_repo.get_tools_by_ids(db, request.tool_ids)
    if not tools:
        raise HTTPException(status_code=400, detail="No valid tools found for the given IDs")

    tool_configs = [
        ToolConfig(
            mcp_server_id=str(t.mcp_server_id),
            mcp_server_name=t.server.name,
            tool_name=t.name,
            tool_description=t.description,
            input_schema=t.input_schema,
            permission_level=t.permission_level,
        )
        for t in tools
    ]

    import uuid

    return AgentConfigSchema(
        agent_id=str(uuid.uuid4()),
        name=request.name,
        description=request.description,
        created_at=datetime.now(timezone.utc).isoformat(),
        model=ModelConfig(
            provider="openai",
            model_id=request.model_id,
            temperature=request.temperature,
        ),
        system_prompt=request.system_prompt,
        tools=tool_configs,
        graph=GraphConfig(type="react_agent", checkpointer=False),
        metadata={
            "user_prompt": request.user_prompt,
            "builder_version": "1.0",
        },
    )


def build_langgraph_agent(
    config: AgentConfigSchema, credentials: dict[str, str] | None = None
) -> Any:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is not configured. Set it in your .env file.",
        )

    llm = ChatOpenAI(
        model=config.model.model_id,
        temperature=config.model.temperature,
        max_tokens=config.model.max_tokens,
        api_key=settings.openai_api_key,
    )

    creds = credentials or {}
    lc_tools = _resolve_tools(config.tools, creds)

    return create_react_agent(
        model=llm,
        tools=lc_tools,
        prompt=config.system_prompt,
    )


def _resolve_tools(
    tool_configs: list[ToolConfig], credentials: dict[str, str]
) -> list[StructuredTool]:
    """Return real tools when credentials are present, placeholders otherwise.

    Credential keys match by substring so 'github-username', 'my-github', etc.
    all resolve to the github token — regardless of what name the user registered.
    """
    tools: list[StructuredTool] = []

    # find github token: any credential key whose name contains "github"
    github_token = next(
        (v for k, v in credentials.items() if "github" in k.lower() and v), None
    )
    github_real = make_github_tools(github_token) if github_token else None

    # find slack token: any credential key whose name contains "slack"
    slack_token = next(
        (v for k, v in credentials.items() if "slack" in k.lower() and v), None
    )
    slack_real = make_slack_tools(slack_token) if slack_token else None

    for tc in tool_configs:
        server = tc.mcp_server_name.lower()
        if "github" in server and github_real:
            match = next((t for t in github_real if t.name.endswith(tc.tool_name)), None)
            tools.append(match or make_placeholder_tool(tc.mcp_server_name, tc.tool_name, tc.tool_description))
        elif "slack" in server and slack_real:
            match = next((t for t in slack_real if t.name.endswith(tc.tool_name)), None)
            tools.append(match or make_placeholder_tool(tc.mcp_server_name, tc.tool_name, tc.tool_description))
        else:
            tools.append(make_placeholder_tool(tc.mcp_server_name, tc.tool_name, tc.tool_description))

    return tools
