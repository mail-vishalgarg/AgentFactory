from typing import Any

import httpx
from langchain_core.tools import StructuredTool

GITHUB_API = "https://api.github.com"
SLACK_API = "https://slack.com/api"


def verify_github_token(token: str) -> tuple[bool, str]:
    """Returns (ok, message). Calls /user to check the token is valid."""
    try:
        resp = httpx.get(
            f"{GITHUB_API}/user",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        if resp.status_code == 200:
            login = resp.json().get("login", "unknown")
            return True, f"Connected as {login}"
        return False, "Invalid token — GitHub returned 401"
    except Exception as exc:
        return False, f"Could not reach GitHub: {exc}"


def verify_slack_token(token: str) -> tuple[bool, str]:
    """Calls auth.test to validate a Slack bot token."""
    try:
        resp = httpx.post(
            f"{SLACK_API}/auth.test",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        data = resp.json()
        if data.get("ok"):
            team = data.get("team", "unknown workspace")
            bot = data.get("bot_id", data.get("user", "bot"))
            return True, f"Connected to {team} as {bot}"
        return False, f"Invalid token — {data.get('error', 'unknown error')}"
    except Exception as exc:
        return False, f"Could not reach Slack: {exc}"


def make_placeholder_tool(server_name: str, tool_name: str, description: str) -> StructuredTool:
    name = f"{server_name}__{tool_name}"

    def _run(**kwargs: Any) -> str:
        return f"[placeholder] {name} called with: {kwargs}"

    return StructuredTool.from_function(func=_run, name=name, description=description)
