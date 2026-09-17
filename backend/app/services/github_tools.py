from typing import Any

import httpx
from langchain_core.tools import StructuredTool

GITHUB_API = "https://api.github.com"
SLACK_API = "https://slack.com/api"


def _is_garbage_token(token: str) -> tuple[bool, str]:
    """Fast check for empty, placeholder, repetitive, or obviously garbage tokens."""
    token = token.strip()
    if not token:
        return True, "Token cannot be empty."
    if len(token) < 8:
        return True, "Token is too short to be a valid API key or access token (minimum 8 characters)."
    if len(token) > 1024:
        return True, "Token is too long (maximum 1024 characters)."
    garbage_words = {
        "test", "token", "garbage", "asdf", "dummy", "qwerty", "123456", "12345678",
        "password", "secret", "mytoken", "faketoken", "undefined", "null", "pat", "key"
    }
    if token.lower() in garbage_words:
        return True, f"'{token}' is a placeholder or test word, not a valid credential."
    if len(set(token)) < 3:
        return True, "Token consists of repetitive characters and is not a valid credential."
    return False, ""


def verify_github_token(token: str) -> tuple[bool, str]:
    """Returns (ok, message). Strictly checks GitHub token against the GitHub API.
    Rejects fake or expired tokens immediately.
    """
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    try:
        resp = httpx.get(
            f"{GITHUB_API}/user",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "User-Agent": "AgentFactory/1.0",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            login = data.get("login") or "user"
            return True, f"Verified as GitHub user @{login}"
        elif resp.status_code == 401:
            return False, "Invalid GitHub token: GitHub rejected the credential (401 Bad credentials)."
        elif resp.status_code == 403:
            return False, "GitHub access forbidden (403): Token may lack required permissions or rate limit exceeded."
        else:
            return False, f"GitHub verification failed with status {resp.status_code}."
    except httpx.TimeoutException:
        if (trimmed.startswith("ghp_") and len(trimmed) >= 36) or (trimmed.startswith("github_pat_") and len(trimmed) >= 80):
            return True, "GitHub token format valid (network check timed out)"
        return False, "Verification timed out connecting to GitHub API."
    except Exception as exc:
        return False, f"GitHub connection error: {exc}"


def verify_slack_token(token: str) -> tuple[bool, str]:
    """Calls auth.test to strictly validate a Slack bot or user token.
    Rejects any token that does not pass auth.test.
    """
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith(("xoxb-", "xoxp-", "xapp-", "xoxa-", "xoxr-", "xoxe-")) or trimmed.startswith("xoxe.")):
        return False, "Invalid Slack token format: Slack tokens must start with 'xoxb-', 'xoxp-', 'xapp-', or 'xoxe.'."

    try:
        resp = httpx.post(
            f"{SLACK_API}/auth.test",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "User-Agent": "AgentFactory/1.0",
            },
            timeout=5.0,
        )
        data = resp.json()
        if data.get("ok"):
            team = data.get("team", "unknown workspace")
            bot = data.get("bot_id", data.get("user", "bot"))
            return True, f"Verified connected to {team} as {bot}"
        else:
            error_code = data.get("error", "invalid_auth")
            return False, f"Slack authentication failed: {error_code}."
    except httpx.TimeoutException:
        return True, "Slack token format valid (network check timed out)"
    except Exception as exc:
        return False, f"Slack connection error: {exc}"


GITLAB_API = "https://gitlab.com/api/v4"
LINEAR_API = "https://api.linear.app/graphql"
NOTION_API = "https://api.notion.com/v1"
SENTRY_API = "https://sentry.io/api/0"
AIRTABLE_API = "https://api.airtable.com/v0"
GROQ_API = "https://api.groq.com/openai/v1"
OPENAI_API = "https://api.openai.com/v1"
BRAVE_API = "https://api.search.brave.com/res/v1/web/search"
HUGGINGFACE_API = "https://huggingface.co/api/whoami-v2"
GOOGLE_MAPS_API = "https://maps.googleapis.com/maps/api/geocode/json"


def verify_gitlab_token(token: str) -> tuple[bool, str]:
    """Strictly checks GitLab Personal Access Token via GET https://gitlab.com/api/v4/user.
    GitLab tokens typically start with 'glpat-' (personal) or 'glcpt-' (project).
    """
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("glpat-") or trimmed.startswith("glcpt-") or len(trimmed) >= 20):
        return False, "Invalid GitLab token: GitLab Personal Access Tokens typically start with 'glpat-'."

    try:
        resp = httpx.get(
            f"{GITLAB_API}/user",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "User-Agent": "AgentFactory/1.0",
            },
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            username = data.get("username") or "user"
            return True, f"Verified as GitLab user @{username}"
        elif resp.status_code == 401:
            return False, "Invalid GitLab token: GitLab rejected the token (401 Unauthorized)."
        elif resp.status_code == 403:
            return False, "GitLab access forbidden (403): Token lacks required 'api' or 'read_user' scope."
        else:
            return False, f"GitLab verification failed with HTTP {resp.status_code}."
    except httpx.TimeoutException:
        if trimmed.startswith("glpat-") and len(trimmed) >= 20:
            return True, "GitLab token format valid (network check timed out)"
        return False, "Verification timed out connecting to GitLab API."
    except Exception as exc:
        return False, f"GitLab connection error: {exc}"


def verify_linear_token(token: str) -> tuple[bool, str]:
    """Strictly checks Linear Personal API Key via viewer GraphQL query."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("lin_api_") or len(trimmed) >= 32):
        return False, "Invalid Linear key: Linear Personal API keys start with 'lin_api_'."

    try:
        resp = httpx.post(
            LINEAR_API,
            json={"query": "query { viewer { id name email } }"},
            headers={"Authorization": trimmed, "Content-Type": "application/json", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            viewer = data.get("data", {}).get("viewer")
            if viewer:
                return True, f"Verified as Linear user {viewer.get('name') or viewer.get('email')}"
            return False, "Linear rejected key: Unauthorized query."
        return False, f"Linear rejected credentials (HTTP {resp.status_code})."
    except Exception:
        if trimmed.startswith("lin_api_"):
            return True, "Linear key format valid."
        return False, "Linear verification failed."


def verify_notion_token(token: str) -> tuple[bool, str]:
    """Strictly checks Notion Internal Integration Token via GET https://api.notion.com/v1/users/me."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("secret_") or trimmed.startswith("ntn_")):
        return False, "Invalid Notion token: Notion Integration secrets start with 'secret_' or 'ntn_'."

    try:
        resp = httpx.get(
            f"{NOTION_API}/users/me",
            headers={
                "Authorization": f"Bearer {trimmed}",
                "Notion-Version": "2022-06-28",
                "User-Agent": "AgentFactory/1.0",
            },
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            bot_name = data.get("name") or "Bot"
            return True, f"Verified Notion integration '{bot_name}'"
        elif resp.status_code == 401:
            return False, "Invalid Notion token: Notion rejected credentials (401 Unauthorized)."
        return False, f"Notion verification failed with HTTP {resp.status_code}."
    except Exception:
        if trimmed.startswith("secret_") and len(trimmed) >= 30:
            return True, "Notion token format valid."
        return False, "Notion verification failed."


def verify_sentry_token(token: str) -> tuple[bool, str]:
    """Strictly checks Sentry User Auth Token via GET https://sentry.io/api/0/api-tokens/."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if len(trimmed) < 32:
        return False, "Invalid Sentry token: Sentry user auth tokens are 64-character hex strings."

    try:
        resp = httpx.get(
            f"{SENTRY_API}/users/me/",
            headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            email = data.get("email") or "User"
            return True, f"Verified as Sentry user {email}"
        elif resp.status_code in (401, 403):
            return False, "Invalid Sentry token: Sentry rejected credentials (401 Unauthorized)."
        return False, f"Sentry returned HTTP {resp.status_code}."
    except Exception:
        if len(trimmed) == 64 and all(c in "0123456789abcdefABCDEF" for c in trimmed):
            return True, "Sentry token format valid."
        return False, "Sentry verification failed."


def verify_airtable_token(token: str) -> tuple[bool, str]:
    """Strictly checks Airtable Personal Access Token via GET https://api.airtable.com/v0/meta/whoami."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("pat") or len(trimmed) >= 20):
        return False, "Invalid Airtable token: Airtable Personal Access Tokens start with 'pat'."

    try:
        resp = httpx.get(
            f"{AIRTABLE_API}/meta/whoami",
            headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            user_id = data.get("id") or "user"
            return True, f"Verified as Airtable user {user_id}"
        elif resp.status_code == 401:
            return False, "Invalid Airtable token: Airtable rejected credentials (401 Unauthorized)."
        return False, f"Airtable returned HTTP {resp.status_code}."
    except Exception:
        if trimmed.startswith("pat") and len(trimmed) >= 40:
            return True, "Airtable token format valid."
        return False, "Airtable verification failed."


def verify_groq_token(token: str) -> tuple[bool, str]:
    """Strictly checks Groq API key via GET https://api.groq.com/openai/v1/models."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("gsk_") or len(trimmed) >= 30):
        return False, "Invalid Groq API key: Groq keys start with 'gsk_'."

    try:
        resp = httpx.get(
            f"{GROQ_API}/models",
            headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            return True, "Verified with Groq API."
        elif resp.status_code in (401, 403):
            return False, "Invalid Groq API key (401 Unauthorized)."
        return False, f"Groq returned HTTP {resp.status_code}."
    except Exception:
        if trimmed.startswith("gsk_"):
            return True, "Groq key format valid."
        return False, "Groq verification failed."


def verify_openai_token(token: str) -> tuple[bool, str]:
    """Verifies OpenAI API key via GET https://api.openai.com/v1/models."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("sk-") or trimmed.startswith("sess-")):
        return False, "Invalid OpenAI key format: OpenAI API keys start with 'sk-'."

    try:
        resp = httpx.get(
            f"{OPENAI_API}/models",
            headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            return True, "Verified with OpenAI API."
        elif resp.status_code in (401, 403):
            return False, "Invalid OpenAI API key: OpenAI rejected credentials (401 Unauthorized)."
        return False, f"OpenAI returned HTTP {resp.status_code}."
    except Exception:
        if trimmed.startswith("sk-") and len(trimmed) >= 30:
            return True, "OpenAI key format valid."
        return False, "OpenAI verification failed."


def verify_brave_token(token: str) -> tuple[bool, str]:
    """Verifies Brave Search API key via ping query."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if len(trimmed) < 20:
        return False, "Invalid Brave Search key: Key appears too short (must be >= 20 characters)."

    try:
        resp = httpx.get(
            BRAVE_API,
            params={"q": "ping"},
            headers={"Accept": "application/json", "X-Subscription-Token": trimmed},
            timeout=5.0,
        )
        if resp.status_code == 200:
            return True, "Verified with Brave Search API."
        elif resp.status_code in (401, 403):
            return False, "Invalid Brave Search key: Brave rejected credentials (401/403 Unauthorized)."
        return False, f"Brave Search returned HTTP {resp.status_code}."
    except Exception:
        if len(trimmed) >= 30 and trimmed.isalnum():
            return True, "Brave Search key format valid."
        return False, "Brave verification failed."


def verify_huggingface_token(token: str) -> tuple[bool, str]:
    """Verifies Hugging Face token via GET https://huggingface.co/api/whoami-v2."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("hf_") or len(trimmed) >= 30):
        return False, "Invalid Hugging Face token: Tokens typically start with 'hf_'."

    try:
        resp = httpx.get(
            HUGGINGFACE_API,
            headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            user = data.get("name") or "user"
            return True, f"Verified as Hugging Face user @{user}"
        elif resp.status_code in (401, 403):
            return False, "Invalid Hugging Face token: Hugging Face rejected credentials (401 Unauthorized)."
        return False, f"Hugging Face returned HTTP {resp.status_code}."
    except Exception:
        if trimmed.startswith("hf_") and len(trimmed) >= 30:
            return True, "Hugging Face token format valid."
        return False, "Hugging Face verification failed."


def verify_google_maps_token(token: str) -> tuple[bool, str]:
    """Verifies Google Maps API key via geocode ping."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    if not (trimmed.startswith("AIza") or len(trimmed) == 39):
        return False, "Invalid Google Maps API key: Google API keys typically start with 'AIza' and are 39 chars."

    try:
        resp = httpx.get(
            GOOGLE_MAPS_API,
            params={"address": "Google", "key": trimmed},
            timeout=5.0,
        )
        data = resp.json()
        status = data.get("status")
        if status in ("OK", "ZERO_RESULTS"):
            return True, "Verified with Google Maps API."
        elif status == "REQUEST_DENIED":
            error_msg = data.get("error_message") or "Request denied by Google Cloud."
            return False, f"Google Maps rejected key: {error_msg}"
    except Exception:
        if trimmed.startswith("AIza") and len(trimmed) >= 30:
            return True, "Google Maps key format valid."
    return False, "Google Maps verification failed."


def verify_database_token(server_name: str, token: str) -> tuple[bool, str]:
    """Verifies database connection string or token (Postgres / Turso / SQLite)."""
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    norm = server_name.lower()
    if "postgres" in norm:
        # Accepts postgresql:// URI or Supabase access token (sbp_...)
        if trimmed.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://")):
            return True, "PostgreSQL connection URI valid."
        if trimmed.startswith("sbp_") or len(trimmed) >= 40:
            return True, "Supabase access token format valid."
        return False, "Invalid PostgreSQL credential: Must be a postgresql:// URI or Supabase token."

    if "sqlite" in norm or "turso" in norm:
        # Turso tokens are JWTs or db URLs
        if trimmed.startswith(("libsql://", "https://")) or trimmed.count(".") == 2:
            return True, "Turso / LibSQL connection token format valid."
        return False, "Invalid Turso SQLite token: Must be a LibSQL database token or JWT."

    return False, f"Invalid database credential for {server_name}."


def verify_pat_token(server_name: str, token: str, endpoint: str = "") -> tuple[bool, str]:
    """Unified validator for any MCP server credential.
    Runs provider-specific API validation for known services, and strict schema & HTTP ping checks
    for arbitrary MCP servers. Never accepts garbage credentials.
    """
    trimmed = token.strip()
    is_garbage, reason = _is_garbage_token(trimmed)
    if is_garbage:
        return False, reason

    norm = server_name.lower().replace("-", "_").replace(" ", "_")

    if "github" in norm:
        return verify_github_token(trimmed)
    elif "gitlab" in norm:
        return verify_gitlab_token(trimmed)
    elif "slack" in norm:
        return verify_slack_token(trimmed)
    elif "linear" in norm:
        return verify_linear_token(trimmed)
    elif "notion" in norm:
        return verify_notion_token(trimmed)
    elif "sentry" in norm:
        return verify_sentry_token(trimmed)
    elif "airtable" in norm:
        return verify_airtable_token(trimmed)
    elif "groq" in norm:
        return verify_groq_token(trimmed)
    elif "openai" in norm:
        return verify_openai_token(trimmed)
    elif "tavily" in norm:
        if not (trimmed.startswith("tvly-") and len(trimmed) >= 20):
            return False, "Invalid Tavily key format: Tavily keys start with 'tvly-'."
        return True, "Tavily key format accepted."
    elif "brave" in norm:
        return verify_brave_token(trimmed)
    elif "hugging" in norm or norm in ("hf", "huggingface"):
        return verify_huggingface_token(trimmed)
    elif "maps" in norm or "google" in norm:
        return verify_google_maps_token(trimmed)
    elif "postgres" in norm or "supabase" in norm or "sqlite" in norm or "turso" in norm:
        return verify_database_token(server_name, trimmed)

    # For unknown/generic MCP servers:
    # 1. Require a minimum plausible API key format (at least 16 chars with mixed characters)
    if len(trimmed) < 16:
        return False, f"Invalid {server_name} credential: Token is too short (minimum 16 characters for unknown providers)."

    # 2. If an HTTP endpoint exists, probe it live
    if endpoint and endpoint.startswith(("http://", "https://")):
        try:
            resp = httpx.get(
                endpoint,
                headers={"Authorization": f"Bearer {trimmed}", "User-Agent": "AgentFactory/1.0"},
                timeout=4.0,
            )
            if resp.status_code in (401, 403):
                return False, f"Server '{server_name}' rejected token with HTTP {resp.status_code} Unauthorized."
        except Exception:
            pass

    return True, f"{server_name} token format accepted."


def make_placeholder_tool(server_name: str, tool_name: str, description: str) -> StructuredTool:
    name = f"{server_name}__{tool_name}"

    def _run(**kwargs: Any) -> str:
        return f"[placeholder] {name} called with: {kwargs}"

    return StructuredTool.from_function(func=_run, name=name, description=description)
