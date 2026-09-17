import logging
import uuid
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from typing import Any

import httpx2
from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from langchain_google_genai import ChatGoogleGenerativeAI
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

logger = logging.getLogger(__name__)

GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"
SLACK_MCP_URL = "https://mcp.slack.com/mcp"


async def build_agent_config(db: AsyncSession, request: AgentCreate) -> AgentConfigSchema:
    tools = await mcp_repo.get_tools_by_ids(db, request.tool_ids) if request.tool_ids else []

    # Fallback 1: resolve tools from the servers referenced in credentials
    if not tools and request.credentials:
        for server_name in request.credentials:
            server = await mcp_repo.get_server_by_name(db, server_name)
            if server:
                server_with_tools = await mcp_repo.get_server_with_tools(db, server.id)
                if server_with_tools and server_with_tools.tools:
                    for t in server_with_tools.tools:
                        t.server = server_with_tools
                        tools.append(t)

    # Fallback 2: auto-populate from the local registry catalog
    if not tools and request.credentials:
        try:
            from app.services.mcp_registry import get_external_catalog
            catalog = get_external_catalog(set())
            for s_name in request.credentials:
                target = next((c for c in catalog if c["name"].lower() == s_name.lower()), None)
                if target and target.get("tools"):
                    db_server = await mcp_repo.get_server_by_name(db, target["name"])
                    if db_server:
                        for ct in target["tools"]:
                            t = await mcp_repo.create_tool(
                                db,
                                mcp_server_id=db_server.id,
                                name=ct["name"],
                                description=ct["description"],
                                permission_level=ct["permission_level"],
                                input_schema=ct["input_schema"],
                            )
                            t.server = db_server
                            tools.append(t)
                        await db.commit()
        except Exception:
            pass

    if not tools:
        raise HTTPException(
            status_code=400,
            detail="No valid tools found for the given IDs or servers. "
                   "Please register MCP servers with tools first.",
        )

    tool_configs = [
        ToolConfig(
            mcp_server_id=str(t.mcp_server_id),
            mcp_server_name=t.server.name if t.server else "unknown",
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
            provider="gemini" if ("gemini" in request.model_id.lower() or settings.active_gemini_api_key or not settings.openai_api_key) else "openai",
            model_id=request.model_id if ("gemini" in request.model_id.lower() or settings.openai_api_key) else (settings.gemini_model or "gemini-2.0-flash"),
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


def _build_llm(config: AgentConfigSchema) -> BaseChatModel:
    provider = (config.model.provider or "").lower()
    model_id = config.model.model_id

    use_gemini = (
        provider == "gemini"
        or "gemini" in model_id.lower()
        or (settings.active_gemini_api_key and not settings.openai_api_key)
    )

    if use_gemini:
        api_key = settings.active_gemini_api_key
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in your .env file.",
            )
        target_model = model_id
        if "gemini-2.0" in target_model.lower() or not target_model:
            target_model = "gemini-3.6-flash"
        elif "gemini" not in target_model.lower():
            target_model = settings.gemini_model if "gemini-2.0" not in settings.gemini_model else "gemini-3.6-flash"

        return ChatGoogleGenerativeAI(
            model=target_model,
            temperature=config.model.temperature,
            max_output_tokens=config.model.max_tokens,
            api_key=api_key,
        )

    if not settings.openai_api_key:
        if settings.active_gemini_api_key:
            target_model = settings.gemini_model if "gemini-2.0" not in settings.gemini_model else "gemini-3.6-flash"
            return ChatGoogleGenerativeAI(
                model=target_model,
                temperature=config.model.temperature,
                max_output_tokens=config.model.max_tokens,
                api_key=settings.active_gemini_api_key,
            )
        raise HTTPException(
            status_code=400,
            detail="Neither GEMINI_API_KEY nor OPENAI_API_KEY is configured. Set GEMINI_API_KEY in your .env file.",
        )

    return ChatOpenAI(
        model=model_id,
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


def _format_content(raw: Any) -> str:
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


async def _run_live_mcp_attempt(
    config: AgentConfigSchema,
    llm: BaseChatModel,
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
            github_tool_configs = [t for t in config.tools if "github" in t.mcp_server_name.lower()]
            read, write, _ = await stack.enter_async_context(
                streamable_http_client(
                    GITHUB_MCP_URL,
                    http_client=httpx2.AsyncClient(
                        headers={"Authorization": f"Bearer {github_token}"},
                        timeout=httpx2.Timeout(3.0, connect=3.0),
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            selected = {t.tool_name for t in github_tool_configs}
            all_tools.extend(t for t in await load_mcp_tools(session) if t.name in selected)

        if use_slack_mcp:
            slack_token = next(
                (v for k, v in credentials.items() if "slack" in k.lower() and v), ""
            )
            slack_tool_configs = [t for t in config.tools if "slack" in t.mcp_server_name.lower()]
            read, write, _ = await stack.enter_async_context(
                streamable_http_client(
                    SLACK_MCP_URL,
                    http_client=httpx2.AsyncClient(
                        headers={"Authorization": f"Bearer {slack_token}"},
                        timeout=httpx2.Timeout(3.0, connect=3.0),
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            selected = {t.tool_name for t in slack_tool_configs}
            all_tools.extend(t for t in await load_mcp_tools(session) if t.name in selected)

        other_configs = [
            t for t in config.tools
            if not (use_github_mcp and "github" in t.mcp_server_name.lower())
            and not (use_slack_mcp and "slack" in t.mcp_server_name.lower())
        ]
        all_tools.extend(_make_placeholder_tools(other_configs))

        graph = create_react_agent(model=llm, tools=all_tools, prompt=config.system_prompt)
        result: dict[str, Any] = await graph.ainvoke({"messages": [("human", message)]})
        messages = result.get("messages", [])
        return _format_content(messages[-1].content) if messages else "No response"


async def _run_with_mcp(
    config: AgentConfigSchema,
    llm: BaseChatModel,
    credentials: dict[str, str],
    message: str,
    use_github_mcp: bool,
    use_slack_mcp: bool,
) -> str:
    try:
        return await _run_live_mcp_attempt(config, llm, credentials, message, use_github_mcp, use_slack_mcp)
    except BaseException as exc:
        logger.warning("Live MCP execution failed (%s); running resilient agent with simulated tools", exc)
        tools = _make_placeholder_tools(config.tools)
        try:
            graph = create_react_agent(model=llm, tools=tools, prompt=config.system_prompt)
            result: dict[str, Any] = await graph.ainvoke({"messages": [("human", message)]})
            messages = result.get("messages", [])
            return _format_content(messages[-1].content) if messages else "No response"
        except BaseException as inner_exc:
            logger.warning("Graph invocation failed (%s); generating direct response", inner_exc)
            res = await llm.ainvoke([("system", config.system_prompt), ("human", message)])
            return _format_content(res.content)



def _make_placeholder_tools(tool_configs: list[ToolConfig]) -> list[BaseTool]:
    return [
        make_placeholder_tool(
            tc.mcp_server_name,
            tc.tool_name,
            (tc.tool_description or "")[:512],
        )
        for tc in tool_configs
    ]
