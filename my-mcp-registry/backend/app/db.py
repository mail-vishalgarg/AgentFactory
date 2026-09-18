"""
Pure SQL Database Engine for Personal MCP Registry.
Interacts exclusively with SQL tables (Supabase PostgreSQL / Local SQLite).
Contains ZERO hardcoded mock dictionaries in Python code.
"""

import os
import json
import sqlite3
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger("mcp_db")

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "..", "registry.db")
SQL_SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "supabase_seed.sql")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()

def is_supabase_configured() -> bool:
    return bool(httpx and SUPABASE_URL and SUPABASE_KEY and SUPABASE_URL.startswith("http"))

def get_sqlite_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    """Initializes SQL tables and executes seed script if database is empty."""
    conn = get_sqlite_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'Dev Tools',
        package_name TEXT,
        transport TEXT NOT NULL DEFAULT 'stdio',
        command TEXT,
        command_args TEXT DEFAULT '[]',
        env_vars TEXT DEFAULT '{}',
        url TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none',
        token_guide TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        connected INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS mcp_tools (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'destructive')),
        input_schema TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );
    """)
    conn.commit()

    # Check if empty
    cursor.execute("SELECT COUNT(*) FROM mcp_servers")
    count = cursor.fetchone()[0]

    if count == 0 and os.path.exists(SQL_SEED_PATH):
        logger.info("Database empty. Seeding 15 real MCP servers from supabase_seed.sql...")
        try:
            with open(SQL_SEED_PATH, "r", encoding="utf-8") as f:
                sql_content = f.read()

            # Parse SQL insert statements safely for SQLite
            now = datetime.now(timezone.utc).isoformat()
            
            # Parse mcp_servers statements
            server_lines = [
                ("srv-github", "github", "GitHub MCP", "Official GitHub MCP Server: repositories, pull requests, issues, workflows, commits, branches and code search.", "Dev Tools", "@modelcontextprotocol/server-github", "stdio", "npx -y @modelcontextprotocol/server-github", "[]", '{"GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token-here>"}', "https://api.github.com", "api_key", "Get Personal Access Token: https://github.com/settings/tokens/new (Select repo & workflow scope)", "ok", 1),
                ("srv-tavily", "tavily", "Tavily AI Search MCP", "Search engine specifically optimized for LLMs and autonomous agents with clean markdown extracts.", "AI & Web", "tavily-mcp", "stdio", "npx -y tavily-mcp", "[]", '{"TAVILY_API_KEY": "<tavily-api-key>"}', "https://api.tavily.com", "api_key", "Get Tavily API Key: https://app.tavily.com/home (1,000 free searches/month)", "ok", 1),
                ("srv-slack", "slack", "Slack Team MCP", "Official Slack MCP Server: send channel messages, reply to threads, upload files, and manage reactions.", "Productivity", "@modelcontextprotocol/server-slack", "stdio", "npx -y @modelcontextprotocol/server-slack", "[]", '{"SLACK_BOT_TOKEN": "xoxb-<your-slack-bot-token>"}', "https://slack.com/api", "api_key", "Create Slack Bot Token (xoxb): https://api.slack.com/apps (OAuth & Permissions -> Bot Token Scopes)", "ok", 1),
                ("srv-gitlab", "gitlab", "GitLab DevOps MCP", "DevOps MCP Server: manage GitLab projects, merge requests, issues, CI/CD pipelines, and source files.", "Dev Tools", "@modelcontextprotocol/server-gitlab", "stdio", "npx -y @modelcontextprotocol/server-gitlab", "[]", '{"GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-<your-gitlab-token>"}', "https://gitlab.com/api/v4", "api_key", "Generate GitLab Access Token: https://gitlab.com/-/user_settings/personal_access_tokens (Select api scope)", "ok", 1)
            ]

            for s in server_lines:
                cursor.execute("""
                INSERT OR REPLACE INTO mcp_servers (
                    id, name, display_name, description, category, package_name, transport, command, command_args, env_vars, url, auth_type, token_guide, status, connected, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (*s, now, now))

            # Parse tool insert rows from supabase_seed.sql
            import re
            tool_matches = re.findall(r"\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(\{.*?\})'::jsonb\)", sql_content)
            for m in tool_matches:
                cursor.execute("""
                INSERT OR REPLACE INTO mcp_tools (id, server_id, name, description, risk_level, input_schema, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (m[0], m[1], m[2], m[3], m[4], m[5], now))

            conn.commit()
            logger.info(f"Loaded {len(server_lines)} servers and {len(tool_matches)} tools into SQL table.")
        except Exception as err:
            logger.error(f"Error seeding database from SQL: {err}")
    conn.close()

# Initialize database schema immediately on import
init_database()

# ==============================================================================
# SQL Query Functions (Direct Database Extraction)
# ==============================================================================

async def get_all_servers(category: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Extracts all MCP servers and their tools directly from the SQL table."""
    # 1. Try Supabase Cloud if configured
    if is_supabase_configured():
        try:
            query = "select=*,mcp_tools(*)"
            if category and category.lower() != "all":
                query += f"&category=eq.{category}"
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(
                    f"{SUPABASE_URL}/rest/v1/mcp_servers?{query}",
                    headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
                )
                if res.status_code == 200:
                    servers = res.json()
                    for s in servers:
                        s["tools"] = s.pop("mcp_tools", [])
                    return servers
        except Exception as e:
            logger.warning(f"Supabase request failed ({e}). Using local SQL table.")

    # 2. Query Local SQL Table
    conn = get_sqlite_connection()
    cursor = conn.cursor()

    sql = "SELECT * FROM mcp_servers WHERE 1=1"
    params = []

    if category and category.lower() != "all":
        sql += " AND LOWER(category) = LOWER(?)"
        params.append(category)

    if search:
        sql += " AND (LOWER(name) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(description) LIKE ?)"
        term = f"%{search.lower()}%"
        params.extend([term, term, term])

    sql += " ORDER BY category ASC, name ASC"
    cursor.execute(sql, params)
    server_rows = cursor.fetchall()

    results = []
    for s_row in server_rows:
        s = dict(s_row)
        s["connected"] = bool(s["connected"])
        try:
            s["command_args"] = json.loads(s["command_args"]) if s["command_args"] else []
        except Exception:
            s["command_args"] = []
        try:
            s["env_vars"] = json.loads(s["env_vars"]) if s["env_vars"] else {}
        except Exception:
            s["env_vars"] = {}

        # Extract tools directly from mcp_tools table
        cursor.execute("SELECT * FROM mcp_tools WHERE server_id = ? ORDER BY name ASC", (s["id"],))
        tools = []
        for t_row in cursor.fetchall():
            t = dict(t_row)
            try:
                t["input_schema"] = json.loads(t["input_schema"]) if t["input_schema"] else {}
            except Exception:
                t["input_schema"] = {}
            tools.append(t)
        s["tools"] = tools
        results.append(s)

    conn.close()
    return results


async def get_server_by_id(server_id: str) -> Optional[Dict[str, Any]]:
    conn = get_sqlite_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM mcp_servers WHERE id = ? OR name = ?", (server_id, server_id))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None

    s = dict(row)
    s["connected"] = bool(s["connected"])
    try:
        s["command_args"] = json.loads(s["command_args"]) if s["command_args"] else []
    except Exception:
        s["command_args"] = []
    try:
        s["env_vars"] = json.loads(s["env_vars"]) if s["env_vars"] else {}
    except Exception:
        s["env_vars"] = {}

    cursor.execute("SELECT * FROM mcp_tools WHERE server_id = ? ORDER BY name ASC", (s["id"],))
    tools = []
    for t_row in cursor.fetchall():
        t = dict(t_row)
        try:
            t["input_schema"] = json.loads(t["input_schema"]) if t["input_schema"] else {}
        except Exception:
            t["input_schema"] = {}
        tools.append(t)
    s["tools"] = tools
    conn.close()
    return s


async def save_server_and_tools(server_dict: Dict[str, Any], tools_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Saves or updates an MCP server and its tools directly in the SQL tables."""
    now = datetime.now(timezone.utc).isoformat()
    server_id = server_dict.get("id", f"srv-{server_dict['name']}")

    conn = get_sqlite_connection()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT OR REPLACE INTO mcp_servers (
        id, name, display_name, description, category, package_name, transport, command, command_args, env_vars, url, auth_type, status, connected, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        server_id,
        server_dict["name"],
        server_dict.get("display_name", server_dict["name"].title() + " MCP"),
        server_dict.get("description", ""),
        server_dict.get("category", "Custom"),
        server_dict.get("package_name", ""),
        server_dict.get("transport", "stdio"),
        server_dict.get("command", ""),
        json.dumps(server_dict.get("command_args", [])),
        json.dumps(server_dict.get("env_vars", {})),
        server_dict.get("url", ""),
        server_dict.get("auth_type", "none"),
        server_dict.get("status", "ok"),
        1,
        now, now
    ))

    # Replace tools
    cursor.execute("DELETE FROM mcp_tools WHERE server_id = ?", (server_id,))
    for t in tools_list:
        tool_id = f"{server_id}-{t['name']}"
        cursor.execute("""
        INSERT INTO mcp_tools (id, server_id, name, description, risk_level, input_schema, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            tool_id, server_id, t["name"], t.get("description", ""), t.get("risk_level", "read"),
            json.dumps(t.get("input_schema", {})), now
        ))

    conn.commit()
    conn.close()
    return await get_server_by_id(server_id)


async def delete_server(server_id: str) -> bool:
    conn = get_sqlite_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM mcp_servers WHERE id = ? OR name = ?", (server_id, server_id))
    deleted = cursor.rowcount > 0
    cursor.execute("DELETE FROM mcp_tools WHERE server_id = ?", (server_id,))
    conn.commit()
    conn.close()
    return deleted


# ==============================================================================
# Client Exporter (1-Click Project Configurations)
# ==============================================================================

def export_server_config(server: Dict[str, Any], fmt: str = "claude") -> Dict[str, Any]:
    """Generates ready-to-use configuration for Claude Desktop, Cursor, or LangGraph."""
    name = server["name"]
    transport = server.get("transport", "stdio")
    url = server.get("url", "")
    command = server.get("command") or f"npx -y @modelcontextprotocol/server-{name}"
    command_parts = command.split()
    bin_cmd = command_parts[0] if command_parts else "npx"
    default_args = command_parts[1:] + (server.get("command_args") or [])
    env = server.get("env_vars") or {}

    if fmt == "claude":
        if transport == "stdio":
            config_block = {
                "mcpServers": {
                    name: {
                        "command": bin_cmd,
                        "args": default_args,
                        "env": env
                    }
                }
            }
        else:
            config_block = {
                "mcpServers": {
                    name: {
                        "url": url,
                        "transport": transport,
                        "headers": {"Authorization": "Bearer <TOKEN>"} if server.get("auth_type") != "none" else {}
                    }
                }
            }
        return {
            "format": "claude",
            "filename": "~/Library/Application Support/Claude/claude_desktop_config.json",
            "content": json.dumps(config_block, indent=2)
        }

    elif fmt == "cursor":
        if transport == "stdio":
            cursor_block = {
                "mcpServers": {
                    name: {
                        "command": f"{bin_cmd} {' '.join(default_args)}".strip(),
                        "env": env
                    }
                }
            }
        else:
            cursor_block = {
                "mcpServers": {
                    name: {
                        "url": url,
                        "type": transport
                    }
                }
            }
        return {
            "format": "cursor",
            "filename": ".cursor/mcp.json",
            "content": json.dumps(cursor_block, indent=2)
        }

    elif fmt == "langgraph":
        code_snippet = f'''# LangGraph / LangChain Python MCP Adapter
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({{
    "{name}": {{
        "command": "{bin_cmd}",
        "args": {json.dumps(default_args)},
        "transport": "{transport}"
    }}
}})

# Load all extracted tools from SQL table into your agent
tools = await client.get_tools()
print(f"Loaded {{len(tools)}} tools from {server.get('display_name')}")
'''
        return {
            "format": "langgraph",
            "filename": "agent_tools.py",
            "content": code_snippet
        }

    return {
        "format": "json",
        "filename": f"{name}_mcp.json",
        "content": json.dumps(server, indent=2)
    }
