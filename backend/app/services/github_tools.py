from typing import Any

import httpx
from langchain_core.tools import StructuredTool

GITHUB_API = "https://api.github.com"
SLACK_API = "https://slack.com/api"


def make_github_tools(token: str) -> list[StructuredTool]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    def list_issues(owner: str, repo: str, state: str = "open") -> str:
        """List issues in a GitHub repository. owner and repo are required."""
        resp = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues",
            params={"state": state, "per_page": 20},
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 401:
            return "Error: Invalid GitHub token. Please reconnect your GitHub account."
        if resp.status_code == 404:
            return f"Error: Repository {owner}/{repo} not found."
        resp.raise_for_status()
        issues = resp.json()
        if not issues:
            return f"No {state} issues found in {owner}/{repo}."
        lines = [f"#{i['number']}: {i['title']} [{i['state']}] — {i['html_url']}" for i in issues]
        return f"Found {len(issues)} issue(s) in {owner}/{repo}:\n" + "\n".join(lines)

    def get_issue(owner: str, repo: str, issue_number: int) -> str:
        """Get details of a specific GitHub issue by number."""
        resp = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues/{issue_number}",
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 401:
            return "Error: Invalid GitHub token."
        if resp.status_code == 404:
            return f"Error: Issue #{issue_number} not found in {owner}/{repo}."
        resp.raise_for_status()
        i = resp.json()
        body_preview = (i.get("body") or "No description")[:600]
        return (
            f"Issue #{i['number']}: {i['title']}\n"
            f"State: {i['state']}\n"
            f"Author: {i['user']['login']}\n"
            f"Labels: {', '.join(l['name'] for l in i.get('labels', [])) or 'none'}\n"
            f"URL: {i['html_url']}\n\n"
            f"Description:\n{body_preview}"
        )

    def get_last_commit(owner: str, repo: str, branch: str = "main") -> str:
        """Get the most recent commit on a branch of a GitHub repository."""
        resp = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/commits",
            params={"sha": branch, "per_page": 1},
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 401:
            return "Error: Invalid GitHub token."
        if resp.status_code == 404:
            return f"Error: Repository {owner}/{repo} or branch '{branch}' not found."
        resp.raise_for_status()
        commits = resp.json()
        if not commits:
            return f"No commits found on branch '{branch}' in {owner}/{repo}."
        c = commits[0]
        commit = c["commit"]
        author = commit.get("author", {})
        return (
            f"Last commit on {owner}/{repo} ({branch}):\n"
            f"SHA:     {c['sha'][:12]}\n"
            f"Author:  {author.get('name', 'unknown')} <{author.get('email', '')}>\n"
            f"Date:    {author.get('date', 'unknown')}\n"
            f"Message: {commit.get('message', '').splitlines()[0]}\n"
            f"URL:     {c['html_url']}"
        )

    def get_repositories(owner: str, repo_type: str = "all") -> str:
        """List GitHub repositories for a user or organisation. owner is required."""
        resp = httpx.get(
            f"{GITHUB_API}/users/{owner}/repos",
            params={"type": repo_type, "sort": "updated", "per_page": 30},
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 401:
            return "Error: Invalid GitHub token."
        if resp.status_code == 404:
            return f"Error: User or organisation '{owner}' not found."
        resp.raise_for_status()
        repos = resp.json()
        if not repos:
            return f"No repositories found for '{owner}'."
        lines = [
            f"- {r['name']} ({'private' if r['private'] else 'public'}) "
            f"⭐{r['stargazers_count']} · {r['language'] or 'unknown'} · {r['html_url']}"
            for r in repos
        ]
        return f"Found {len(repos)} repo(s) for '{owner}':\n" + "\n".join(lines)

    return [
        StructuredTool.from_function(
            func=list_issues,
            name="github__list_issues",
            description="List open (or closed) issues in a GitHub repository. Requires owner and repo.",
        ),
        StructuredTool.from_function(
            func=get_issue,
            name="github__get_issue",
            description="Get full details of a specific GitHub issue by its number.",
        ),
        StructuredTool.from_function(
            func=get_last_commit,
            name="github__get_last_commit",
            description="Get the most recent commit on a branch of a GitHub repository. Defaults to main branch.",
        ),
        StructuredTool.from_function(
            func=get_repositories,
            name="github__get_repositories",
            description="List repositories for a GitHub user or organisation. Pass owner (e.g. 'mail-vishalgarg').",
        ),
    ]


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


def make_slack_tools(token: str) -> list[StructuredTool]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }

    def _resolve_channel_id(name: str) -> tuple[str, str | None]:
        """Return (channel_id, error). Tries public then private channel lists."""
        name = name.lstrip("#").strip()
        for ch_type in ("public_channel", "private_channel"):
            resp = httpx.get(
                f"{SLACK_API}/conversations.list",
                params={"types": ch_type, "exclude_archived": "true", "limit": 1000},
                headers=headers,
                timeout=15,
            )
            data = resp.json()
            if data.get("ok"):
                for c in data.get("channels", []):
                    if c.get("name") == name or c.get("id") == name:
                        return str(c["id"]), None
            elif data.get("error") == "missing_scope":
                needed = data.get("needed", "channels:read or groups:read")
                return name, (
                    f"Error: Your Slack app is missing the '{needed}' scope. "
                    f"Go to api.slack.com/apps → your app → OAuth & Permissions → "
                    f"Bot Token Scopes → add '{needed}' → reinstall the app."
                )
        return name, None  # name not found — pass it through and let conversations.history surface the real error

    def _slack_err(err: str, channel: str, extra: str = "") -> str:
        if err == "missing_scope":
            return (
                f"Error: Missing Slack scope. Go to api.slack.com/apps → your app → "
                f"OAuth & Permissions → Bot Token Scopes → add 'channels:history' and "
                f"'channels:read' → reinstall the app and paste the new token."
            )
        if err == "not_in_channel":
            return f"Error: Bot is not in #{channel}. In Slack type: /invite @AgentFactory"
        if err == "channel_not_found":
            return (
                f"Error: Channel '{channel}' not found. "
                f"Make sure the channel exists and the bot is invited (/invite @AgentFactory). "
                + extra
            )
        if err == "invalid_auth":
            return "Error: Invalid Slack token."
        return f"Slack API error: {err}"

    def read_channel(channel: str, limit: int = 10) -> str:
        """Read recent messages from a Slack channel. Pass the channel name like vishalgarg or #vishalgarg."""
        channel_id, resolve_err = _resolve_channel_id(channel)
        if resolve_err:
            return resolve_err

        resp = httpx.get(
            f"{SLACK_API}/conversations.history",
            params={"channel": channel_id, "limit": limit},
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            err = data.get("error", "unknown_error")
            extra = f"(resolved channel_id={channel_id})" if channel_id != channel.lstrip("#") else ""
            return _slack_err(err, channel, extra)

        messages = data.get("messages", [])
        if not messages:
            return f"No messages found in #{channel}."
        lines = []
        for m in messages:
            user = m.get("user", m.get("bot_id", "unknown"))
            text = (m.get("text") or "").replace("\n", " ")[:200]
            ts = m.get("ts", "")
            lines.append(f"[ts={ts}] [{user}]: {text}")
        return f"Last {len(lines)} message(s) in #{channel}:\n" + "\n".join(lines)

    def delete_message(channel: str, ts: str) -> str:
        """Delete a Slack message by its timestamp (ts). Call read_channel first — each message shows its ts value."""
        channel_id, resolve_err = _resolve_channel_id(channel)
        if resolve_err:
            return resolve_err
        resp = httpx.post(
            f"{SLACK_API}/chat.delete",
            json={"channel": channel_id, "ts": ts},
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            err = data.get("error", "unknown_error")
            if err == "message_not_found":
                return f"Error: No message with ts={ts} in that channel. Call read_channel first to get the correct ts."
            if err == "cant_delete_message":
                return "Error: Bot can only delete messages it posted itself."
            return _slack_err(err, channel)
        return f"Message ts={ts} deleted from {channel}."

    def post_message(channel: str, text: str) -> str:
        """Post a message to a Slack channel. channel can be #general or a channel ID."""
        if not channel.startswith("#") and not channel.startswith("C"):
            channel = f"#{channel}"
        resp = httpx.post(
            f"{SLACK_API}/chat.postMessage",
            json={"channel": channel, "text": text},
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            err = data.get("error", "unknown_error")
            if err == "not_in_channel":
                return f"Error: Bot is not in {channel}. Invite it with /invite @YourBot first."
            if err == "channel_not_found":
                return f"Error: Channel '{channel}' not found."
            if err == "invalid_auth":
                return "Error: Invalid Slack token."
            return f"Slack API error: {err}"
        ts = data.get("ts", "")
        return f"Message posted to {channel} (ts={ts}): {text[:80]}"

    return [
        StructuredTool.from_function(
            func=read_channel,
            name="slack__read_channel",
            description="Read the most recent messages from a Slack channel. Pass channel name like 'general' or '#general'.",
        ),
        StructuredTool.from_function(
            func=post_message,
            name="slack__post_message",
            description="Post a message to a Slack channel. Pass channel name like '#general' and the text to send.",
        ),
        StructuredTool.from_function(
            func=delete_message,
            name="slack__delete_message",
            description="Delete a message the bot posted in a Slack channel. Requires channel name and the message ts (timestamp). Use read_channel first to find the ts.",
        ),
    ]


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
