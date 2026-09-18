import logging
import uuid
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx2
from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
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

_TOOL_SELECTION_THRESHOLD = 5  # skip LLM selection if total tools <= this


@dataclass
class RunResult:
    output: str
    status: str = "ok"
    thread_id: str | None = None
    pending_tool_name: str | None = None
    pending_tool_args: dict[str, Any] | None = field(default=None)


# thread_id → (graph, thread_config, config, credentials) for pending approvals
_approval_registry: dict[str, tuple[Any, dict[str, Any], AgentConfigSchema, dict[str, str]]] = {}

_READ_INTENT_KEYWORDS = {"read", "get", "fetch", "list", "search", "view", "find", "show", "check", "look"}
_WRITE_INTENT_KEYWORDS = {"create", "write", "update", "edit", "delete", "merge", "push", "post", "send", "modify"}

# Tool name tokens that indicate write or destructive operations
_DESTRUCTIVE_TOKENS = {"delete", "remove", "destroy", "revoke", "dismiss", "close", "cancel"}
_WRITE_TOKENS = {"create", "post", "push", "write", "update", "edit", "merge", "add",
                 "submit", "approve", "request", "assign", "label", "comment", "reply"}


def _is_read_only_intent(user_prompt: str) -> bool:
    words = set(user_prompt.lower().split())
    has_read = bool(words & _READ_INTENT_KEYWORDS)
    has_write = bool(words & _WRITE_INTENT_KEYWORDS)
    return has_read and not has_write


def _tool_needs_approval(tool_name: str) -> bool:
    """Classify a tool by name — independent of whatever permission_level is stored in the DB."""
    tokens = set(tool_name.lower().replace("_", " ").split())
    return bool(tokens & (_DESTRUCTIVE_TOKENS | _WRITE_TOKENS))


async def _select_relevant_tools(
    user_prompt: str,
    tools: list,
    model_id: str,
) -> list:
    """Use the LLM to pick only tools relevant to the user's task, respecting permission levels."""
    read_only = _is_read_only_intent(user_prompt)

    # Hard filter: strip write/destructive tools for clearly read-only tasks
    if read_only:
        tools = [t for t in tools if t.permission_level not in ("write", "destructive")]

    if len(tools) <= _TOOL_SELECTION_THRESHOLD:
        return tools

    permission_note = (
        "IMPORTANT: This is a READ-ONLY task. Do NOT include any tools with WRITE or DESTRUCTIVE permissions.\n"
        if read_only else ""
    )

    tool_list = "\n".join(
        f"- {t.name} [{t.permission_level.upper()}]: {(t.description or '')[:120]}"
        for t in tools
    )
    selection_prompt = (
        f"You are selecting tools for an AI agent.\n"
        f"Task: {user_prompt}\n\n"
        f"{permission_note}"
        f"Available tools (name [permission_level]: description):\n{tool_list}\n\n"
        "Reply with ONLY the exact tool names needed to accomplish this task, "
        "one per line, no explanations, no bullet points."
    )

    # Build a minimal LLM just for selection
    use_openai = "gpt" in model_id.lower()
    if use_openai and settings.openai_api_key:
        from langchain_openai import ChatOpenAI as _OpenAI
        llm = _OpenAI(model=model_id, temperature=0.0, api_key=settings.openai_api_key)
    elif settings.active_gemini_api_key:
        target = model_id if "gemini" in model_id.lower() else (settings.gemini_model or "gemini-2.0-flash")
        llm = ChatGoogleGenerativeAI(model=target, temperature=0.0, api_key=settings.active_gemini_api_key)
    else:
        return tools  # no LLM available — keep all

    try:
        response = await llm.ainvoke([("human", selection_prompt)])
        selected_names = {
            line.strip().lower()
            for line in str(response.content).splitlines()
            if line.strip()
        }
        filtered = [t for t in tools if t.name.lower() in selected_names]
        # Second hard filter: never let write tools through for read-only tasks
        if read_only:
            filtered = [t for t in filtered if t.permission_level not in ("write", "destructive")]
        return filtered if filtered else tools
    except Exception:
        return tools  # fallback: keep all tools if selection fails


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

    # Filter to only the tools relevant to the user's task
    user_prompt = request.user_prompt or request.system_prompt or request.description
    tools = await _select_relevant_tools(user_prompt, tools, request.model_id)

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
            provider="openai" if "gpt" in request.model_id.lower() else "gemini",
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


def _build_llm(config: AgentConfigSchema) -> BaseChatModel:
    model_id = config.model.model_id

    # model_id takes priority — "gpt" in the name always means OpenAI
    use_openai = "gpt" in model_id.lower()

    if use_openai:
        if not settings.openai_api_key:
            raise HTTPException(
                status_code=400,
                detail="OPENAI_API_KEY is not configured. Set OPENAI_API_KEY in your .env file.",
            )
        return ChatOpenAI(
            model=model_id,
            temperature=config.model.temperature,
            max_tokens=config.model.max_tokens,
            api_key=settings.openai_api_key,
        )

    # Gemini path
    api_key = settings.active_gemini_api_key
    if not api_key:
        # Fallback: if OpenAI key is available, use it instead of erroring
        if settings.openai_api_key:
            return ChatOpenAI(
                model=settings.openai_model or "gpt-4o-mini",
                temperature=config.model.temperature,
                max_tokens=config.model.max_tokens,
                api_key=settings.openai_api_key,
            )
        raise HTTPException(
            status_code=400,
            detail="Neither GEMINI_API_KEY nor OPENAI_API_KEY is configured.",
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


async def execute_agent(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    message: str,
) -> RunResult:
    """Build and run the agent, returning a RunResult."""
    llm = _build_llm(config)
    creds = credentials or {}

    github_token = next((v for k, v in creds.items() if "github" in k.lower() and v), None)
    slack_token = next((v for k, v in creds.items() if "slack" in k.lower() and v), None)
    has_github = any("github" in t.mcp_server_name.lower() for t in config.tools)
    has_slack = any("slack" in t.mcp_server_name.lower() for t in config.tools)
    use_github_mcp = bool(github_token and has_github)
    use_slack_mcp = bool(slack_token and has_slack)

    # Classify by tool name at runtime — stored permission_level may be stale
    # (catalog-registered tools often default to "read" regardless of actual risk)
    has_approval_tools = any(_tool_needs_approval(t.tool_name) for t in config.tools)
    if has_approval_tools:
        return await _run_with_approval_check(config, llm, creds, message)

    if use_github_mcp or use_slack_mcp:
        raw = await _run_with_mcp(config, llm, creds, message, use_github_mcp, use_slack_mcp)
        return RunResult(output=raw)

    tools = _make_placeholder_tools(config.tools)
    graph = create_react_agent(model=llm, tools=tools, prompt=config.system_prompt)
    result: dict[str, Any] = await graph.ainvoke({"messages": [("human", message)]})
    msgs = result.get("messages", [])
    return RunResult(output=_format_content(msgs[-1].content) if msgs else "No response")


async def _run_with_approval_check(
    config: AgentConfigSchema,
    llm: BaseChatModel,
    credentials: dict[str, str],
    message: str,
) -> RunResult:
    tools = _make_placeholder_tools(config.tools)
    checkpointer = MemorySaver()
    thread_id = str(uuid.uuid4())
    thread_config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}

    graph = create_react_agent(
        model=llm,
        tools=tools,
        prompt=config.system_prompt,
        checkpointer=checkpointer,
        interrupt_before=["tools"],
    )

    try:
        await graph.ainvoke({"messages": [("human", message)]}, config=thread_config)
    except Exception as exc:
        logger.warning("Approval-aware agent run error: %s", exc)
        return RunResult(output=f"Agent error: {exc}")

    return await _handle_graph_state(graph, thread_config, config, credentials)


async def _handle_graph_state(
    graph: Any,
    thread_config: dict[str, Any],
    config: AgentConfigSchema,
    credentials: dict[str, str],
) -> RunResult:
    for _ in range(20):
        state = graph.get_state(thread_config)
        if not state.next:
            break

        msgs = state.values.get("messages", [])
        last = msgs[-1] if msgs else None
        if not (last and hasattr(last, "tool_calls") and last.tool_calls):
            break

        pending_call = last.tool_calls[0]
        tool_name: str = pending_call["name"] if isinstance(pending_call, dict) else pending_call.name
        tool_args: dict[str, Any] = pending_call["args"] if isinstance(pending_call, dict) else pending_call.args

        needs_approval = _tool_needs_approval(tool_name)
        if needs_approval:
            tid = thread_config["configurable"]["thread_id"]
            _approval_registry[tid] = (graph, thread_config, config, credentials)
            return RunResult(
                output=f"⏸ Waiting for approval to run `{tool_name}`",
                status="pending_approval",
                thread_id=tid,
                pending_tool_name=tool_name,
                pending_tool_args=tool_args,
            )

        # Read-only tool — auto-approve: execute real tool and inject result
        tc = last.tool_calls[0]
        tool_call_id = tc["id"] if isinstance(tc, dict) else tc.id
        real_result = await _execute_real_tool(config, credentials, tool_name, tool_args)
        graph.update_state(
            thread_config,
            {"messages": [ToolMessage(content=real_result, tool_call_id=tool_call_id)]},
            as_node="tools",
        )
        try:
            await graph.ainvoke(None, config=thread_config)
        except Exception as exc:
            logger.warning("Auto-continue failed: %s", exc)
            break

    state = graph.get_state(thread_config)
    msgs = state.values.get("messages", [])
    return RunResult(output=_format_content(msgs[-1].content) if msgs else "No response")


def _mcp_tool_name(tool_name: str) -> str:
    """Strip server prefix from tool name (e.g. 'github__delete_file' → 'delete_file')."""
    return tool_name.split("__", 1)[-1] if "__" in tool_name else tool_name


def _extract_mcp_result(result: Any) -> str:
    """Turn an MCP CallToolResult into a string, surfacing errors clearly."""
    parts = [
        c.text if hasattr(c, "text") else str(c)
        for c in (result.content or [])
    ]
    text = "\n".join(parts).strip()
    if getattr(result, "isError", False):
        return f"[TOOL ERROR] {text or 'Tool returned an error with no details'}"
    return text or "[Tool completed with no output]"


async def _execute_real_tool(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    tool_name: str,
    tool_args: dict[str, Any],
) -> str:
    """Execute a tool for real via live MCP connection after user approval."""
    tool_cfg = next((t for t in config.tools if t.tool_name == tool_name), None)
    server_name = (tool_cfg.mcp_server_name if tool_cfg else "").lower()
    mcp_name = _mcp_tool_name(tool_name)

    if "github" in server_name:
        github_token = next((v for k, v in credentials.items() if "github" in k.lower() and v), None)
        if github_token:
            try:
                async with AsyncExitStack() as stack:
                    read, write, _ = await stack.enter_async_context(
                        streamable_http_client(
                            GITHUB_MCP_URL,
                            http_client=httpx2.AsyncClient(
                                headers={"Authorization": f"Bearer {github_token}"},
                                timeout=httpx2.Timeout(15.0, connect=5.0),
                            ),
                        )
                    )
                    session = await stack.enter_async_context(ClientSession(read, write))
                    await session.initialize()
                    result = await session.call_tool(mcp_name, tool_args)
                    return _extract_mcp_result(result)
            except Exception as exc:
                logger.warning("GitHub tool %s failed: %s", mcp_name, exc)
                return f"[TOOL EXECUTION FAILED] {exc}"
        return "[TOOL EXECUTION FAILED] No GitHub token available"

    if "slack" in server_name:
        slack_token = next((v for k, v in credentials.items() if "slack" in k.lower() and v), None)
        if slack_token:
            try:
                async with AsyncExitStack() as stack:
                    read, write, _ = await stack.enter_async_context(
                        streamable_http_client(
                            SLACK_MCP_URL,
                            http_client=httpx2.AsyncClient(
                                headers={"Authorization": f"Bearer {slack_token}"},
                                timeout=httpx2.Timeout(15.0, connect=5.0),
                            ),
                        )
                    )
                    session = await stack.enter_async_context(ClientSession(read, write))
                    await session.initialize()
                    result = await session.call_tool(mcp_name, tool_args)
                    return _extract_mcp_result(result)
            except Exception as exc:
                logger.warning("Slack tool %s failed: %s", mcp_name, exc)
                return f"[TOOL EXECUTION FAILED] {exc}"
        return "[TOOL EXECUTION FAILED] No Slack token available"

    return f"[TOOL EXECUTION FAILED] No live MCP connection for server '{server_name}'"


async def resume_agent(thread_id: str, approved: bool) -> RunResult:
    """Resume a paused agent after human approval or rejection."""
    entry = _approval_registry.pop(thread_id, None)
    if entry is None:
        raise HTTPException(status_code=404, detail="No pending approval found for this run.")

    graph, thread_config, config, credentials = entry

    state = graph.get_state(thread_config)
    msgs = state.values.get("messages", [])
    last = msgs[-1] if msgs else None

    if last and hasattr(last, "tool_calls") and last.tool_calls:
        tc = last.tool_calls[0]
        tool_call_id = tc["id"] if isinstance(tc, dict) else tc.id

        if approved:
            tool_name = tc["name"] if isinstance(tc, dict) else tc.name
            tool_args: dict[str, Any] = tc["args"] if isinstance(tc, dict) else tc.args
            real_result = await _execute_real_tool(config, credentials, tool_name, tool_args)
            # Inject real result as if the tools node ran — moves graph to agent node
            graph.update_state(
                thread_config,
                {"messages": [ToolMessage(content=real_result, tool_call_id=tool_call_id)]},
                as_node="tools",
            )
        else:
            rejections = [
                ToolMessage(
                    content="Tool execution rejected by the user.",
                    tool_call_id=tc2["id"] if isinstance(tc2, dict) else tc2.id,
                )
                for tc2 in last.tool_calls
            ]
            graph.update_state(thread_config, {"messages": rejections}, as_node="tools")

    try:
        await graph.ainvoke(None, config=thread_config)
    except Exception as exc:
        logger.warning("Resume invocation error: %s", exc)
        return RunResult(output=f"Resume error: {exc}")

    # Check if another approval gate is hit
    for _ in range(20):
        state = graph.get_state(thread_config)
        if not state.next:
            break
        msgs = state.values.get("messages", [])
        last = msgs[-1] if msgs else None
        if not (last and hasattr(last, "tool_calls") and last.tool_calls):
            break
        pending_call = last.tool_calls[0]
        next_tool_name = pending_call["name"] if isinstance(pending_call, dict) else pending_call.name
        next_tool_args: dict[str, Any] = pending_call["args"] if isinstance(pending_call, dict) else pending_call.args
        _approval_registry[thread_id] = (graph, thread_config, config, credentials)
        return RunResult(
            output=f"⏸ Waiting for approval to run `{next_tool_name}`",
            status="pending_approval",
            thread_id=thread_id,
            pending_tool_name=next_tool_name,
            pending_tool_args=next_tool_args,
        )

    state = graph.get_state(thread_config)
    msgs = state.values.get("messages", [])
    return RunResult(output=_format_content(msgs[-1].content) if msgs else "No response")


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
                        timeout=httpx2.Timeout(20.0, connect=10.0),
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            server_tools = await load_mcp_tools(session)
            selected = {t.tool_name for t in github_tool_configs}
            selected_stripped = {_mcp_tool_name(n) for n in selected}
            matched = [
                t for t in server_tools
                if t.name in selected or t.name in selected_stripped
            ]
            all_tools.extend(matched if matched else server_tools)

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
                        timeout=httpx2.Timeout(20.0, connect=10.0),
                    ),
                )
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            server_tools = await load_mcp_tools(session)
            # Match by exact name OR by stripping a server-name prefix (slack_send_message → send_message)
            selected = {t.tool_name for t in slack_tool_configs}
            selected_stripped = {_mcp_tool_name(n) for n in selected}
            matched = [
                t for t in server_tools
                if t.name in selected or t.name in selected_stripped
            ]
            all_tools.extend(matched if matched else server_tools)

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
        server = "Slack" if use_slack_mcp else "GitHub" if use_github_mcp else "MCP"
        logger.warning("Live MCP execution failed for %s: %s", server, exc)
        return (
            f"⚠ Could not connect to the {server} MCP server. "
            f"Please check that your {server} token is valid and has the required scopes. "
            f"Error: {exc}"
        )



def _make_placeholder_tools(tool_configs: list[ToolConfig]) -> list[BaseTool]:
    return [
        make_placeholder_tool(
            tc.mcp_server_name,
            tc.tool_name,
            (tc.tool_description or "")[:512],
            tc.input_schema or {},
        )
        for tc in tool_configs
    ]
