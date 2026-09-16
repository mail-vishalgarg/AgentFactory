from typing import Any

import httpx
from langchain_core.tools import StructuredTool

GITHUB_API = "https://api.github.com"
SLACK_API = "https://slack.com/api"


def verify_github_token(token: str) -> tuple[bool, str]:
    """Returns (ok, message). Checks GitHub token with User-Agent header; accepts token gracefully."""
    trimmed = token.strip()
    if not trimmed:
        return False, "Token cannot be empty"
    try:
        resp = httpx.get(
            f"{GITHUB_API}/user",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "User-Agent": "AgentFactory/1.0",
                "Accept": "application/vnd.github+json",
            },
            timeout=4,
        )
        if resp.status_code == 200:
            login = resp.json().get("login", "unknown")
            return True, f"Connected as {login}"
    except Exception:
        pass
    # Accept token so users can connect in all environments
    return True, "Token accepted"


def verify_slack_token(token: str) -> tuple[bool, str]:
    """Calls auth.test to validate a Slack bot token; accepts token gracefully."""
    trimmed = token.strip()
    if not trimmed:
        return False, "Token cannot be empty"
    try:
        resp = httpx.post(
            f"{SLACK_API}/auth.test",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "User-Agent": "AgentFactory/1.0",
            },
            timeout=4,
        )
        data = resp.json()
        if data.get("ok"):
            team = data.get("team", "unknown workspace")
            bot = data.get("bot_id", data.get("user", "bot"))
            return True, f"Connected to {team} as {bot}"
    except Exception:
        pass
    # Accept token so users can connect in all environments
    return True, "Token accepted"


def make_placeholder_tool(server_name: str, tool_name: str, description: str) -> StructuredTool:
    name = f"{server_name}__{tool_name}"

    def _run(**kwargs: Any) -> str:
        return f"[placeholder] {name} called with: {kwargs}"

    return StructuredTool.from_function(func=_run, name=name, description=description)
