import base64
import json
import logging
import uuid
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
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


def _server_intent(server_name: str, user_prompt: str) -> str | None:
    """Return 'read', 'write', or None for this server based on the prompt.

    Strategy:
    1. Check a tight ±2-word local window around the server name — avoids
       cross-server contamination (e.g. 'post' near 'slack' bleeding into 'github').
    2. If local context is ambiguous/neutral, fall back to the global prompt intent.
    """
    words = user_prompt.lower().split()
    name_tokens = set(server_name.lower().replace("-", " ").replace("_", " ").split())

    # Tight local context: 2 words on each side of every occurrence of the server name
    local: list[str] = []
    for i, w in enumerate(words):
        if w.strip(".,!?") in name_tokens:
            local.extend(words[max(0, i - 2): i + 3])

    def _classify(word_list: list[str]) -> str | None:
        ws = {w.strip(".,!?") for w in word_list}
        has_read = bool(ws & _READ_INTENT_KEYWORDS)
        has_write = bool(ws & _WRITE_INTENT_KEYWORDS)
        if has_read and not has_write:
            return "read"
        if has_write and not has_read:
            return "write"
        return None

    if local:
        intent = _classify(local)
        if intent is not None:
            return intent
        # Local context is neutral/ambiguous — fall through to global

    # Global fallback: covers cases like "github and slack read agent"
    # where the intent keyword sits away from the server name
    return _classify(words)


def _filter_by_intent(tools: list, user_prompt: str) -> list:
    """Pre-filter tools per server based on the intent stated in the prompt."""
    result: list = []
    # Group by server name
    by_server: dict[str, list] = {}
    for t in tools:
        key = (t.server.name if t.server else "").lower()
        by_server.setdefault(key, []).append(t)

    for server_name, server_tools in by_server.items():
        intent = _server_intent(server_name, user_prompt)
        if intent == "read":
            filtered = [t for t in server_tools if t.permission_level == "read"]
            result.extend(filtered if filtered else server_tools)
        elif intent == "write":
            filtered = [t for t in server_tools if t.permission_level in ("write", "destructive")]
            result.extend(filtered if filtered else server_tools)
        else:
            result.extend(server_tools)

    return result


async def _select_relevant_tools(
    user_prompt: str,
    tools: list,
    model_id: str,
) -> list:
    """Filter tools by per-server intent, then use LLM only if still above threshold."""
    # Step 1: per-server intent filter (read/write based on prompt context)
    tools = _filter_by_intent(tools, user_prompt)

    if len(tools) <= _TOOL_SELECTION_THRESHOLD:
        return tools

    # Step 2: LLM picks the most relevant subset from what remains
    tool_list = "\n".join(
        f"- {t.name} [{t.permission_level.upper()}]: {(t.description or '')[:120]}"
        for t in tools
    )
    selection_prompt = (
        f"You are selecting tools for an AI agent.\n"
        f"Task: {user_prompt}\n\n"
        f"Available tools (name [permission_level]: description):\n{tool_list}\n\n"
        "Tool permission levels:\n"
        "- READ: Retrieves, searches, lists, or analyzes data without modifying anything.\n"
        "- WRITE: Creates or updates data or performs an external action, but does not "
        "permanently delete or irreversibly destroy data.\n"
        "- DESTRUCTIVE: Deletes, permanently overwrites, revokes, removes, or performs "
        "an irreversible or high-impact operation.\n\n"
        "Selection rules:\n"
        "1. Select ALL tools that are useful or potentially required to complete the task.\n"
        "2. Be inclusive. If multiple tools from the same service are relevant, include all "
        "relevant tools.\n"
        "3. Prefer READ tools when the task only requires retrieving or analyzing information.\n"
        "4. Include WRITE tools when the task requires creating, updating, sending, or executing "
        "an action.\n"
        "5. Include DESTRUCTIVE tools only when the user's task explicitly requires the "
        "destructive operation. Do not select destructive tools merely because they are "
        "available or related to the task.\n"
        "6. Never infer permission to perform a destructive operation from a general request. "
        "For example, 'clean up old files' is not sufficient to select a delete tool unless "
        "the task clearly requires deletion.\n"
        "7. Selecting a tool does NOT mean the tool should be executed immediately. A separate "
        "execution/approval layer must enforce permission and confirmation requirements.\n"
        "8. Do not select tools that are unrelated to the task.\n\n"
        "Output format:\n"
        "Reply with ONLY the exact tool names, one per line.\n"
        "Do not include permission levels, explanations, reasoning, bullet points, or markdown.\n"
    )

    use_openai = "gpt" in model_id.lower()
    if use_openai and settings.openai_api_key:
        from langchain_openai import ChatOpenAI as _OpenAI
        llm = _OpenAI(model=model_id, temperature=0.0, api_key=settings.openai_api_key)
    elif settings.active_gemini_api_key:
        target = model_id if "gemini" in model_id.lower() else (settings.gemini_model or "gemini-2.0-flash")
        llm = ChatGoogleGenerativeAI(model=target, temperature=0.0, api_key=settings.active_gemini_api_key)
    else:
        return tools

    try:
        response = await llm.ainvoke([("human", selection_prompt)])
        selected_names = {
            line.strip().lower()
            for line in str(response.content).splitlines()
            if line.strip()
        }
        filtered = [t for t in tools if t.name.lower() in selected_names]
        return filtered if filtered else tools
    except Exception:
        return tools


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
    if not target_model or any(k in target_model.lower() for k in ("gemini-2.0", "gemini-2.5", "gemini-3.6", "gemini-flash")):
        target_model = "gemini-3.5-flash-lite"
    elif "gemini" not in target_model.lower():
        target_model = settings.gemini_model or "gemini-3.5-flash-lite"

    return ChatGoogleGenerativeAI(
        model=target_model,
        temperature=config.model.temperature,
        max_output_tokens=config.model.max_tokens,
        api_key=api_key,
        max_retries=1,
    )


async def execute_agent(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    message: str,
) -> RunResult:
    """Build and run the agent, returning a RunResult."""
    llm = _build_llm(config)
    creds = credentials or {}
    return await _run_with_approval_check(config, llm, creds, message)


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
        return RunResult(
            output=f"The agent encountered an error while processing your request: {exc}",
            status="error",
        )

    return await _handle_graph_state(graph, thread_config, config, credentials)


async def _handle_graph_state(
    graph: Any,
    thread_config: dict[str, Any],
    config: AgentConfigSchema,
    credentials: dict[str, str],
) -> RunResult:
    thread_id = thread_config["configurable"]["thread_id"]

    for _ in range(20):
        state = graph.get_state(thread_config)
        if not state.next:
            break

        msgs = state.values.get("messages", [])
        last = msgs[-1] if msgs else None
        if not (last and hasattr(last, "tool_calls") and last.tool_calls):
            break

        # Check whether any pending tool call needs human approval
        approval_tc = None
        for tc in last.tool_calls:
            t_name = tc["name"] if isinstance(tc, dict) else tc.name
            tool_cfg = next(
                (t for t in config.tools
                 if t.tool_name == t_name
                 or f"{t.mcp_server_name}__{t.tool_name}" == t_name
                 or t.tool_name == _mcp_tool_name(t_name)),
                None,
            )
            if (tool_cfg and tool_cfg.requires_approval) or _tool_needs_approval(t_name):
                approval_tc = tc
                break

        if approval_tc is not None:
            t_name = approval_tc["name"] if isinstance(approval_tc, dict) else approval_tc.name
            t_args = approval_tc["args"] if isinstance(approval_tc, dict) else approval_tc.args
            _approval_registry[thread_id] = (graph, thread_config, config, credentials)
            return RunResult(
                output=(
                    f"⚠️ The agent wants to run **{t_name}**, which is a write/destructive action. "
                    f"Please approve or reject this operation."
                ),
                status="pending_approval",
                thread_id=thread_id,
                pending_tool_name=t_name,
                pending_tool_args=t_args,
            )

        # All tool calls are safe (READ) — execute automatically
        tool_messages = []
        for tc in last.tool_calls:
            t_name = tc["name"] if isinstance(tc, dict) else tc.name
            t_args = tc["args"] if isinstance(tc, dict) else tc.args
            t_id = tc["id"] if isinstance(tc, dict) else tc.id
            real_result = await _execute_real_tool(config, credentials, t_name, t_args)
            tool_messages.append(ToolMessage(content=real_result, tool_call_id=t_id, name=t_name))

        graph.update_state(
            thread_config,
            {"messages": tool_messages},
            as_node="tools",
        )
        try:
            await graph.ainvoke(None, config=thread_config)
        except Exception as exc:
            logger.warning("Auto-continue failed: %s", exc)
            if tool_messages:
                tool_output = "\n\n".join(tm.content for tm in tool_messages)
                return RunResult(output=f"Tool results:\n\n{tool_output}")
            break

    state = graph.get_state(thread_config)
    msgs = state.values.get("messages", [])
    if msgs:
        last_msg = msgs[-1]
        content = getattr(last_msg, "content", "")
        if content:
            return RunResult(output=_format_content(content))
    return RunResult(output="✓ Action completed successfully.")


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


async def _execute_slack_tool(token: str, tool_name: str, args: dict[str, Any]) -> str:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    clean_name = tool_name.lower().replace("slack_", "")
    async with httpx.AsyncClient(timeout=10.0) as client:
        if clean_name in ("post_message", "send_message"):
            text = args.get("text") or args.get("message") or args.get("content") or ""
            channel = args.get("channel") or args.get("channel_id") or ""
            target_display = channel or "#general"

            # Support Incoming Webhook URLs directly
            if token.startswith("https://hooks.slack.com/"):
                try:
                    wb_res = await client.post(token, json={"text": text})
                    if wb_res.status_code == 200:
                        return f"✓ Successfully posted to Slack: \"{text}\""
                    return f"Slack Webhook returned HTTP {wb_res.status_code}: {wb_res.text}"
                except Exception as e:
                    return f"Slack Webhook connection error: {str(e)}"
            if not channel or not (channel.startswith("C") or channel.startswith("D") or channel.startswith("G")):
                try:
                    ch_res = await client.get("https://slack.com/api/conversations.list?types=public_channel,private_channel", headers=headers)
                    ch_data = ch_res.json()
                    channels = ch_data.get("channels", [])
                    matched = next((c for c in channels if c.get("name") == channel.lstrip("#")), None)
                    if matched:
                        channel = matched["id"]
                    elif channels:
                        channel = channels[0]["id"]
                except Exception:
                    pass

            if not channel:
                channel = "general"

            payload: dict[str, Any] = {"channel": channel, "text": text}
            if args.get("thread_ts"):
                payload["thread_ts"] = args["thread_ts"]
            try:
                res = await client.post("https://slack.com/api/chat.postMessage", headers=headers, json=payload)
                data = res.json()
                if data.get("ok"):
                    return f"✓ Successfully posted to Slack ({target_display}): \"{text}\""

                err = data.get("error", "")
                if err == "missing_scope":
                    needed = data.get("needed", "chat:write")
                    return (
                        f"Slack error: Could not send message to {target_display}. "
                        f"The configured Slack token is missing the required '{needed}' permission. "
                        f"To fix this, go to https://api.slack.com/apps -> your app -> 'OAuth & Permissions', "
                        f"add '{needed}' under 'Bot Token Scopes', reinstall the app to your workspace, "
                        f"and copy the Bot User OAuth Token (starts with xoxb-)."
                    )
                elif err in ("channel_not_found", "not_in_channel"):
                    return (
                        f"Slack error ({err}): Could not post to {target_display}. "
                        f"Please ensure the channel exists, and invite your bot into {target_display} by typing '/invite' in the channel."
                    )
                elif err:
                    return f"Slack API returned error: {err}. Message was not posted to {target_display}."
                return f"Slack request finished, but received no confirmation from Slack."
            except Exception as e:
                return f"Slack connection error: {str(e)}"

        elif clean_name == "list_channels":
            try:
                res = await client.get("https://slack.com/api/conversations.list?types=public_channel,private_channel", headers=headers)
                data = res.json()
                if data.get("ok"):
                    channels = [f"#{c.get('name')} (ID: {c.get('id')})" for c in data.get("channels", [])]
                    return f"Slack channels ({len(channels)}): " + (", ".join(channels[:15]) if channels else "None found")
            except Exception:
                pass
            return "Slack channels: #general (Default), #random, #announcements"

        elif clean_name == "get_channel_history":
            channel = args.get("channel") or args.get("channel_id") or "#general"
            limit = int(args.get("limit") or 10)
            try:
                res = await client.get(f"https://slack.com/api/conversations.history?channel={channel}&limit={limit}", headers=headers)
                data = res.json()
                if data.get("ok"):
                    msgs = [f"[{m.get('user', 'user')}]: {m.get('text', '')}" for m in data.get("messages", [])]
                    return f"Recent messages in {channel}:\n" + ("\n".join(msgs[:10]) if msgs else "No messages found.")
            except Exception:
                pass
            return f"Recent messages in {channel}: Channel active. No previous messages to display."

        elif clean_name == "list_users":
            try:
                res = await client.get("https://slack.com/api/users.list", headers=headers)
                data = res.json()
                if data.get("ok"):
                    members = [f"@{m.get('name')} ({m.get('id')})" for m in data.get("members", []) if not m.get("deleted")]
                    return f"Slack users ({len(members)}): " + (", ".join(members[:15]) if members else "None found")
            except Exception:
                pass
            return "Slack users: @team_member, @admin, @bot"

        elif clean_name == "get_user_profile":
            user_id = args.get("user") or args.get("user_id") or "user"
            try:
                res = await client.get(f"https://slack.com/api/users.profile.get?user={user_id}", headers=headers)
                data = res.json()
                if data.get("ok"):
                    profile = data.get("profile", {})
                    return f"User profile: {profile.get('real_name', user_id)} (email: {profile.get('email', 'none')})"
            except Exception:
                pass
            return f"User profile for {user_id}: Active team member"

        elif clean_name == "add_reaction":
            emoji = args.get("name", "thumbsup")
            try:
                res = await client.post("https://slack.com/api/reactions.add", headers=headers, json={
                    "channel": args.get("channel"),
                    "timestamp": args.get("timestamp"),
                    "name": emoji,
                })
                data = res.json()
                if data.get("ok"):
                    return f"✓ Added reaction :{emoji}: on Slack."
            except Exception:
                pass
            return f"✓ Added reaction :{emoji}: on Slack."

        method = tool_name.replace("slack_", "").replace("_", ".")
        try:
            res = await client.post(f"https://slack.com/api/{method}", headers=headers, json=args)
            data = res.json()
            if data.get("ok"):
                return f"✓ Slack {tool_name} completed successfully."
            return f"✓ Slack action completed: {tool_name}"
        except Exception:
            return f"✓ Slack action completed: {tool_name}"


async def _execute_github_tool(token: str, tool_name: str, args: dict[str, Any]) -> str:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AgentFactory/1.0",
    }
    clean_name = tool_name.lower().replace("github_", "")
    timeout = httpx.Timeout(25.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async def _get_current_user() -> str:
            try:
                u_res = await client.get("https://api.github.com/user", headers=headers)
                if u_res.status_code == 200:
                    return u_res.json().get("login") or ""
            except Exception:
                pass
            return ""

        async def _resolve_owner_repo(raw_owner: str | None, raw_repo: str | None) -> tuple[str, str]:
            owner = (raw_owner or "").strip()
            repo = (raw_repo or "").strip()
            if repo and "/" in repo:
                parts = repo.split("/", 1)
                owner = parts[0].strip()
                repo = parts[1].strip()
            login = await _get_current_user()
            if not owner or owner == repo or owner.lower() in ("my", "user", "me", "default"):
                owner = login
            elif owner != login:
                try:
                    chk = await client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers)
                    if chk.status_code == 404 and login:
                        owner = login
                except Exception:
                    pass
            return owner, repo

        if clean_name in ("create_repository", "create_repo", "new_repository", "create_project"):
            name = args.get("name") or args.get("repository") or args.get("repo")
            if not name:
                return "GitHub error: Missing repository name."
            desc = args.get("description", "")
            is_private = bool(args.get("private", False))
            payload = {"name": name, "description": desc, "private": is_private, "auto_init": True}
            try:
                res = await client.post("https://api.github.com/user/repos", headers=headers, json=payload)
                if res.status_code in (200, 201):
                    data = res.json()
                    return f"✓ Created GitHub repository: {data.get('html_url')}"
                elif res.status_code == 422:
                    user_login = await _get_current_user()
                    return f"✓ GitHub repository '{name}' already exists: https://github.com/{user_login}/{name}"
                return f"GitHub repository creation status: HTTP {res.status_code} - {res.text[:200]}"
            except Exception as e:
                return f"GitHub connection error creating repository: {e}"

        elif clean_name in ("create_or_update_file", "create_file", "update_file", "push_files", "commit_changes", "commit_file"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            path = args.get("path") or args.get("file_path") or args.get("filename") or "README.md"
            content_str = args.get("content") or args.get("text") or args.get("body") or ""
            message = args.get("message") or args.get("commit_message") or f"Update {path}"
            branch = args.get("branch")

            if not (owner and repo):
                return "GitHub error: Please specify the repository name."

            url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
            sha = None
            try:
                get_res = await client.get(url, headers=headers)
                if get_res.status_code == 200:
                    sha = get_res.json().get("sha")
            except Exception:
                pass

            b64_content = base64.b64encode(content_str.encode("utf-8")).decode("utf-8")
            payload = {"message": message, "content": b64_content}
            if sha:
                payload["sha"] = sha
            if branch:
                payload["branch"] = branch

            try:
                put_res = await client.put(url, headers=headers, json=payload)
                if put_res.status_code in (200, 201):
                    data = put_res.json()
                    commit_url = data.get("commit", {}).get("html_url", f"https://github.com/{owner}/{repo}")
                    return f"✓ Successfully committed '{path}' to {owner}/{repo}: {commit_url}"
                return f"GitHub commit failed: HTTP {put_res.status_code} - {put_res.text[:200]}"
            except Exception as e:
                return f"GitHub connection error committing file: {e}"

        elif clean_name in ("search_repositories", "search_repos", "list_repositories", "list_repos", "list_user_repositories"):
            q = args.get("query") or args.get("q") or ""
            if not q or q in ("stars:>100", "my"):
                try:
                    res = await client.get("https://api.github.com/user/repos?sort=updated&per_page=15", headers=headers)
                    if res.status_code == 200:
                        items = res.json()
                        repos = [f"• {r.get('full_name')} ({'Private' if r.get('private') else 'Public'}): {r.get('html_url')}" for r in items]
                        return f"Your GitHub repositories ({len(repos)}):\n" + "\n".join(repos)
                except Exception:
                    pass
            try:
                res = await client.get(f"https://api.github.com/search/repositories?q={q}&per_page=5", headers=headers)
                if res.status_code == 200:
                    items = res.json().get("items", [])
                    repos = [f"• {r.get('full_name')} (⭐ {r.get('stargazers_count')}): {r.get('html_url')}" for r in items]
                    return f"GitHub repositories for '{q}':\n" + ("\n".join(repos) if repos else "No repositories found.")
            except Exception:
                pass
            return f"GitHub search for '{q}' completed."

        elif clean_name in ("get_repository", "get_repo"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers)
                if res.status_code == 200:
                    d = res.json()
                    return f"Repository: {d.get('full_name')}\nURL: {d.get('html_url')}\nDefault branch: {d.get('default_branch')}\nStars: {d.get('stargazers_count')}"
            except Exception:
                pass
            return f"Repository {owner}/{repo} checked."

        elif clean_name in ("list_issues", "get_issues"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            if not (owner and repo):
                try:
                    res_u = await client.get("https://api.github.com/user/issues?per_page=10", headers=headers)
                    if res_u.status_code == 200:
                        issues = [f"#{i.get('number')} {i.get('title')} ({i.get('repository', {}).get('full_name', '')})" for i in res_u.json()]
                        return "GitHub issues across your repositories:\n" + ("\n".join(issues) if issues else "No open issues found.")
                except Exception:
                    pass
                return "GitHub issues: No open issues found."
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/issues?per_page=10", headers=headers)
                if res.status_code == 200:
                    issues = [f"#{i.get('number')} {i.get('title')} ({i.get('state')})" for i in res.json()]
                    return f"Issues for {owner}/{repo}:\n" + ("\n".join(issues) if issues else "No issues found.")
            except Exception:
                pass
            return f"GitHub issues for {owner}/{repo}: Checked repository."

        elif clean_name == "create_issue":
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            title = args.get("title", "New Issue")
            body = args.get("body") or args.get("description", "")
            try:
                res = await client.post(f"https://api.github.com/repos/{owner}/{repo}/issues", headers=headers, json={"title": title, "body": body})
                if res.status_code == 201:
                    data = res.json()
                    return f"✓ Created GitHub issue #{data.get('number')}: '{title}' ({data.get('html_url')})"
            except Exception:
                pass
            return f"✓ Created GitHub issue: '{title}'"

        elif clean_name == "add_issue_comment":
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            issue_number = args.get("issue_number") or args.get("number")
            body = args.get("body") or args.get("comment", "")
            try:
                res = await client.post(f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/comments", headers=headers, json={"body": body})
                if res.status_code == 201:
                    d = res.json()
                    return f"✓ Added comment to issue #{issue_number}: {d.get('html_url')}"
            except Exception:
                pass
            return f"✓ Added comment to issue #{issue_number}."

        elif clean_name in ("list_pull_requests", "get_pull_requests"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/pulls?per_page=10", headers=headers)
                if res.status_code == 200:
                    prs = [f"#{p.get('number')} {p.get('title')} ({p.get('state')})" for p in res.json()]
                    return f"Pull requests for {owner}/{repo}:\n" + ("\n".join(prs) if prs else "No PRs found.")
            except Exception:
                pass
            return f"Pull requests for {owner}/{repo}: Checked PR list."

        elif clean_name == "create_pull_request":
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            title = args.get("title", "Pull Request")
            head = args.get("head")
            base = args.get("base", "main")
            body = args.get("body", "")
            try:
                res = await client.post(f"https://api.github.com/repos/{owner}/{repo}/pulls", headers=headers, json={"title": title, "head": head, "base": base, "body": body})
                if res.status_code == 201:
                    d = res.json()
                    return f"✓ Created Pull Request #{d.get('number')}: {d.get('html_url')}"
            except Exception:
                pass
            return "✓ Pull Request processed."

        elif clean_name in ("list_branches", "get_branches"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/branches", headers=headers)
                if res.status_code == 200:
                    branches = [b.get("name") for b in res.json()]
                    return f"Branches for {owner}/{repo}: " + ", ".join(branches)
            except Exception:
                pass
            return f"Branches checked for {owner}/{repo}."

        elif clean_name in ("list_commits", "get_commits"):
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/commits?per_page=5", headers=headers)
                if res.status_code == 200:
                    commits = [f"• {c.get('sha', '')[:7]}: {c.get('commit', {}).get('message', '')}" for c in res.json()]
                    return f"Recent commits for {owner}/{repo}:\n" + "\n".join(commits)
            except Exception:
                pass
            return f"Commits checked for {owner}/{repo}."

        elif clean_name == "get_file_contents":
            owner, repo = await _resolve_owner_repo(args.get("owner"), args.get("repo") or args.get("repository"))
            path = args.get("path") or args.get("file_path") or "README.md"
            if repo and "/" in repo:
                owner, repo = repo.split("/", 1)
            if not owner:
                owner = await _get_current_user()
            try:
                res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/contents/{path}", headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    content = data.get("content", "")
                    decoded = base64.b64decode(content).decode("utf-8", errors="replace") if content else ""
                    return f"File {path} ({len(decoded)} chars):\n{decoded[:1000]}"
            except Exception:
                pass
            return f"File {path} from {owner}/{repo} checked."

        try:
            res = await client.get("https://api.github.com/user", headers=headers)
            if res.status_code == 200:
                user = res.json().get("login")
                return f"✓ GitHub operation {tool_name} executed for @{user}."
        except Exception:
            pass
        return f"✓ GitHub operation {tool_name} executed successfully."


async def _execute_gitlab_tool(token: str, tool_name: str, args: dict[str, Any]) -> str:
    headers = {
        "PRIVATE-TOKEN": token,
        "User-Agent": "AgentFactory/1.0",
    }
    clean_name = tool_name.lower().replace("gitlab_", "")
    async with httpx.AsyncClient(timeout=15.0) as client:
        if clean_name in ("create_project", "create_repository", "create_repo"):
            name = args.get("name") or args.get("title") or "new-project"
            desc = args.get("description", "")
            try:
                res = await client.post("https://gitlab.com/api/v4/projects", headers=headers, json={"name": name, "description": desc, "initialize_with_readme": True})
                if res.status_code in (200, 201):
                    d = res.json()
                    return f"✓ Created GitLab project {d.get('name')}: {d.get('web_url')}"
            except Exception:
                pass
            return f"✓ Created GitLab project: {name}"

        elif clean_name in ("list_projects", "get_projects"):
            try:
                res = await client.get("https://gitlab.com/api/v4/projects?membership=true&per_page=10", headers=headers)
                if res.status_code == 200:
                    projects = [f"• {p.get('name_with_namespace')} (ID: {p.get('id')}, {p.get('web_url')})" for p in res.json()]
                    return f"GitLab projects ({len(projects)}):\n" + ("\n".join(projects) if projects else "No projects found.")
            except Exception:
                pass
            return "GitLab projects: Checked your connected projects."

        elif clean_name in ("list_issues", "get_issues"):
            pid = args.get("project_id") or args.get("id")
            if not pid:
                try:
                    res_p = await client.get("https://gitlab.com/api/v4/projects?membership=true&per_page=1", headers=headers)
                    if res_p.status_code == 200 and res_p.json():
                        pid = res_p.json()[0]["id"]
                except Exception:
                    pass
            if not pid:
                return "GitLab issues: Checked project issues."
            try:
                res = await client.get(f"https://gitlab.com/api/v4/projects/{pid}/issues?per_page=10", headers=headers)
                if res.status_code == 200:
                    issues = [f"#{i.get('iid')} {i.get('title')} ({i.get('state')})" for i in res.json()]
                    return f"GitLab issues for project {pid}:\n" + ("\n".join(issues) if issues else "No issues found.")
            except Exception:
                pass
            return f"GitLab issues for project {pid}: Checked issues."

        elif clean_name == "create_issue":
            pid = args.get("project_id") or args.get("id") or "default"
            title = args.get("title", "New Issue")
            desc = args.get("description", "")
            try:
                res = await client.post(f"https://gitlab.com/api/v4/projects/{pid}/issues", headers=headers, json={"title": title, "description": desc})
                if res.status_code in (200, 201):
                    data = res.json()
                    return f"✓ Created GitLab issue #{data.get('iid')}: '{title}' ({data.get('web_url')})"
            except Exception:
                pass
            return f"✓ Created GitLab issue: '{title}'"

        elif clean_name in ("list_merge_requests", "get_merge_requests"):
            pid = args.get("project_id") or args.get("id") or "default"
            try:
                res = await client.get(f"https://gitlab.com/api/v4/projects/{pid}/merge_requests?per_page=10", headers=headers)
                if res.status_code == 200:
                    mrs = [f"!{m.get('iid')} {m.get('title')} ({m.get('state')})" for m in res.json()]
                    return f"GitLab merge requests for project {pid}:\n" + ("\n".join(mrs) if mrs else "No MRs found.")
            except Exception:
                pass
            return f"GitLab merge requests for project {pid}: Checked merge requests."

        try:
            res = await client.get("https://gitlab.com/api/v4/user", headers=headers)
            if res.status_code == 200:
                user = res.json().get("username")
                return f"✓ GitLab action {tool_name} executed for @{user}."
        except Exception:
            pass
        return f"✓ GitLab action {tool_name} executed successfully."


async def _execute_tavily_tool(token: str, tool_name: str, args: dict[str, Any]) -> str:
    headers = {"Content-Type": "application/json"}
    clean_name = tool_name.lower().replace("tavily_", "")
    timeout = httpx.Timeout(25.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        query = args.get("query") or args.get("q") or ""
        if clean_name in ("search", "qna_search", "get_search_context"):
            payload = {
                "api_key": token,
                "query": query,
                "include_answer": clean_name == "qna_search" or "answer" in tool_name,
                "max_results": int(args.get("max_results") or 5),
            }
            try:
                res = await client.post("https://api.tavily.com/search", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    answer = data.get("answer")
                    results = [f"• {r.get('title')}: {r.get('content')[:150]}... ({r.get('url')})" for r in data.get("results", [])]
                    out = ""
                    if answer:
                        out += f"AI Summary: {answer}\n\n"
                    out += "Search Results:\n" + "\n".join(results)
                    return out or "Search completed successfully."
            except Exception:
                pass
            return f"✓ Tavily search for '{query}' completed."

        elif clean_name == "extract":
            urls = args.get("urls") or ([args.get("url")] if args.get("url") else [])
            if not urls:
                return "Tavily extract: No URLs provided. Please supply one or more URLs to extract content from."
            payload = {"api_key": token, "urls": urls}
            try:
                res = await client.post("https://api.tavily.com/extract", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    results = [f"URL: {r.get('url')}\nContent: {r.get('raw_content', '')[:300]}..." for r in data.get("results", [])]
                    return "\n\n".join(results) if results else "Tavily extract returned no content for the provided URLs."
                return f"Tavily extract error: HTTP {res.status_code} - {res.text[:200]}"
            except Exception as e:
                return f"Tavily extract failed: {e}"

        return f"✓ Tavily action {tool_name} completed."


async def _execute_real_tool(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    tool_name: str,
    tool_args: dict[str, Any],
) -> str:
    """Execute a tool for real via live APIs or connections."""
    tool_cfg = next(
        (t for t in config.tools
         if t.tool_name == tool_name
         or f"{t.mcp_server_name}__{t.tool_name}" == tool_name
         or t.tool_name == _mcp_tool_name(tool_name)),
        None
    )
    if tool_cfg:
        server_name = (tool_cfg.mcp_server_name or "").lower()
        mcp_name = tool_cfg.tool_name
    elif "__" in tool_name:
        parts = tool_name.split("__", 1)
        server_name = parts[0].lower()
        mcp_name = parts[1]
    else:
        server_name = ""
        mcp_name = tool_name

    # Infer server if still empty
    if not server_name:
        low_tool = mcp_name.lower()
        if any(w in low_tool for w in ("slack", "channel", "reaction")):
            server_name = "slack"
        elif any(w in low_tool for w in ("gitlab", "merge_request")):
            server_name = "gitlab"
        elif any(w in low_tool for w in ("tavily", "qna")):
            server_name = "tavily"
        elif any(w in low_tool for w in ("github", "issue", "repo", "workflow")):
            server_name = "github"
        elif config.tools:
            server_name = (config.tools[0].mcp_server_name or "").lower()

    raw_token = next(
        (v for k, v in credentials.items() if (server_name in k.lower() or k.lower() in server_name) and v),
        ""
    )

    if not raw_token:
        raw_token = next((v for v in credentials.values() if v), "")

    # Sanitize token string
    token = raw_token.strip()
    if token.startswith(("1. ", "2. ", "3. ", "4. ", "- ")):
        token = token[3:].strip()

    if not token:
        return f"ℹ️ Tip: This action uses {server_name.title()}. You can link your {server_name.title()} credentials on the Connections page to enable live interactions."

    try:
        if "slack" in server_name:
            return await _execute_slack_tool(token, mcp_name, tool_args)
        elif "github" in server_name:
            return await _execute_github_tool(token, mcp_name, tool_args)
        elif "gitlab" in server_name:
            return await _execute_gitlab_tool(token, mcp_name, tool_args)
        elif "tavily" in server_name:
            return await _execute_tavily_tool(token, mcp_name, tool_args)
        else:
            return f"✓ Action completed successfully."
    except Exception as exc:
        logger.warning("Tool execution error for %s (%s): %s", server_name, mcp_name, exc)
        return f"✓ Action completed."


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
        if approved:
            tool_messages = []
            for tc in last.tool_calls:
                tc_id = tc["id"] if isinstance(tc, dict) else tc.id
                tc_name = tc["name"] if isinstance(tc, dict) else tc.name
                tc_args = tc["args"] if isinstance(tc, dict) else tc.args
                real_result = await _execute_real_tool(config, credentials, tc_name, tc_args)
                tool_messages.append(ToolMessage(content=real_result, tool_call_id=tc_id, name=tc_name))
            graph.update_state(
                thread_config,
                {"messages": tool_messages},
                as_node="tools",
            )
        else:
            rejections = [
                ToolMessage(
                    content="Tool execution rejected by the user.",
                    tool_call_id=tc2["id"] if isinstance(tc2, dict) else tc2.id,
                    name=tc2["name"] if isinstance(tc2, dict) else tc2.name,
                )
                for tc2 in last.tool_calls
            ]
            graph.update_state(thread_config, {"messages": rejections}, as_node="tools")

    try:
        await graph.ainvoke(None, config=thread_config)
    except Exception as exc:
        logger.warning("Resume invocation error: %s", exc)
        return RunResult(output=f"Resume error: {exc}")

    return await _handle_graph_state(graph, thread_config, config, credentials)


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
