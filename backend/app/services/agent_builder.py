import uuid
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from typing import Any

import httpx2
from fastapi import HTTPException
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.repositories import mcp as mcp_repo
from app.schemas.agent import AgentConfigSchema, AgentCreate, GraphConfig, ModelConfig, ToolConfig
from app.services.github_tools import make_placeholder_tool

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"
SLACK_MCP_URL = "https://mcp.slack.com/mcp"


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
            requires_approval=t.permission_level in ("write", "destructive"),
        )
        for t in tools
    ]

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


def _build_llm(config: AgentConfigSchema) -> ChatOpenAI:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is not configured. Set it in your .env file.",
        )
    return ChatOpenAI(
        model=config.model.model_id,
        temperature=config.model.temperature,
        max_tokens=config.model.max_tokens,
        api_key=settings.openai_api_key,
    )


async def execute_agent(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    message: str,
) -> str:
    """Build and run the agent, returning the final text output."""
    llm = _build_llm(config)
    creds = credentials or {}

    github_token = next((v for k, v in creds.items() if "github" in k.lower() and v), None)
    slack_token = next((v for k, v in creds.items() if "slack" in k.lower() and v), None)
    has_github = any("github" in t.mcp_server_name.lower() for t in config.tools)
    has_slack = any("slack" in t.mcp_server_name.lower() for t in config.tools)

    use_github_mcp = bool(github_token and has_github)
    use_slack_mcp = bool(slack_token and has_slack)

    if use_github_mcp or use_slack_mcp:
        return await _run_with_mcp(config, llm, creds, message, use_github_mcp, use_slack_mcp)

    tools = _make_placeholder_tools(config.tools)
    graph = create_react_agent(model=llm, tools=tools, prompt=config.system_prompt)
    result: dict[str, Any] = await graph.ainvoke({"messages": [("human", message)]})
    messages = result.get("messages", [])
    return str(messages[-1].content) if messages else "No response"


async def _run_with_mcp(
    config: AgentConfigSchema,
    llm: ChatOpenAI,
    credentials: dict[str, str],
    message: str,
    use_github_mcp: bool,
    use_slack_mcp: bool,
) -> str:
    all_tools: list[BaseTool] = []

    async with AsyncExitStack() as stack:
        if use_github_mcp:
            github_token = next(
                (v for k, v in credentials.items() if "github" in k.lower() and v), ""
            )
            read, write, _ = await stack.enter_async_context(
                streamable_http_client(
                    GITHUB_MCP_URL,
                    http_client=httpx2.AsyncClient(
                        headers={"Authorization": f"Bearer {github_token}"}
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            selected = {t.tool_name for t in config.tools if "github" in t.mcp_server_name.lower()}
            all_tools.extend(t for t in await load_mcp_tools(session) if t.name in selected)

        if use_slack_mcp:
            slack_token = next(
                (v for k, v in credentials.items() if "slack" in k.lower() and v), ""
            )
            read, write, _ = await stack.enter_async_context(
                streamable_http_client(
                    SLACK_MCP_URL,
                    http_client=httpx2.AsyncClient(
                        headers={"Authorization": f"Bearer {slack_token}"}
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            selected = {t.tool_name for t in config.tools if "slack" in t.mcp_server_name.lower()}
            all_tools.extend(t for t in await load_mcp_tools(session) if t.name in selected)

        # placeholder tools for any other server (non-GitHub, non-Slack)
        other_configs = [
            t for t in config.tools
            if not (use_github_mcp and "github" in t.mcp_server_name.lower())
            and not (use_slack_mcp and "slack" in t.mcp_server_name.lower())
        ]
        all_tools.extend(_make_placeholder_tools(other_configs))

        graph = create_react_agent(model=llm, tools=all_tools, prompt=config.system_prompt)
        result: dict[str, Any] = await graph.ainvoke({"messages": [("human", message)]})
        messages = result.get("messages", [])
        return str(messages[-1].content) if messages else "No response"


def _make_placeholder_tools(tool_configs: list[ToolConfig]) -> list[BaseTool]:
    return [
        make_placeholder_tool(
            tc.mcp_server_name,
            tc.tool_name,
            (tc.tool_description or "")[:512],
        )
        for tc in tool_configs
    ]
