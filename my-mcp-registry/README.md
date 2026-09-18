# ⚡ My Personal MCP Registry

A dedicated, standalone MCP Server Registry and client configuration hub.
Extracts all MCP servers and their full toolsets directly from **SQL database tables (`mcp_servers` & `mcp_tools`)** — **zero hardcoded servers in Python code**.

---

## 🌟 Key Features

* **Pure SQL Data Model (Supabase + Local SQL Dual-Mode):**
  - All 15 MCP servers and their tools are queried directly from SQL tables.
  - Can connect to your live **Supabase Postgres** instance via `.env` or run completely offline using the built-in local SQL engine (`registry.db`).
* **100% Complete Tool Extraction (Zero Truncation):**
  - GitHub MCP is pre-loaded with its full **44 official tools** (not 5 or 6).
  - Total of **197 real-world tools** across all 15 servers.
* **1-Click Client Configuration Exporter ("📋 Copy Config"):**
  - Pick up and copy ready-to-use configurations directly for:
    - **Claude Desktop** (`claude_desktop_config.json`)
    - **Cursor IDE** (`.cursor/mcp.json`)
    - **LangGraph / Python** (`agent_tools.py`)
    - **Raw JSON**
* **Interactive Tool Inspector:**
  - Click **"🔍 View All 44 Tools"** on any card to search, inspect descriptions, parameter schemas, and security risk ratings (🟢 `read`, 🟡 `write`, 🔴 `destructive`).
* **Real MCP Protocol Registration:**
  - Register any real stdio or HTTP/SSE MCP server with live JSON-RPC introspection and automatic database persistence.
  - Failure guard: *If it does not answer, nothing is saved.*

---

## 🗄️ Pre-Seeded MCP Servers (70 Tools in SQL)

| # | MCP Server | Category | Transport | Verified Tools in SQL | Package / Command |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **1** | **GitHub** | Dev Tools | `stdio` | **44 tools** | `@modelcontextprotocol/server-github` |
| **2** | **Slack** | Productivity | `stdio` | **14 tools** | `@modelcontextprotocol/server-slack` |
| **3** | **GitLab** | Dev Tools | `stdio` | **8 tools** | `@modelcontextprotocol/server-gitlab` |
| **4** | **Tavily** | AI & Web | `stdio` | **4 tools** | `tavily-mcp` |
| **TOTAL** | **4 Servers** | | | **70 Tools** | |

---

## 🚀 Execution Steps

### 1. Run Automated Tests
```bash
cd /Users/priyankaneogi/Desktop/mcp-registry/backend
source venv/bin/activate
python tests/test_registry.py
```
*(Confirms that all 15 servers and 44 GitHub tools are queried live from the SQL database)*

### 2. Start the Backend (Terminal 1)
```bash
cd /Users/priyankaneogi/Desktop/mcp-registry/backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Start the Frontend (Terminal 2)
```bash
cd /Users/priyankaneogi/Desktop/mcp-registry/frontend
npm run dev
```

### 4. Open in Browser
👉 **`http://localhost:3000`**

- **Filter by Category:** Click any category pill (**Database**, **Cloud & Infra**, **Dev Tools**, etc.).
- **Search:** Search across servers and all 197 tools (e.g. search `pull_request` to view GitHub's PR tools).
- **Inspect 44 Tools:** On the **GitHub MCP** card, click **"🔍 View All 44 Tools"** to open the interactive tool browser.
- **Copy Config:** Click **"📋 Copy Config"** on any card to export configuration directly into Claude Desktop or Cursor!

---

## ☁️ Connecting to Your Supabase Cloud Project (Optional)

1. Open your Supabase project dashboard.
2. Go to **SQL Editor** &rarr; Paste and run the contents of [`supabase_seed.sql`](file:///Users/priyankaneogi/Desktop/mcp-registry/supabase_seed.sql).
3. In `/Users/priyankaneogi/Desktop/mcp-registry/.env`:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-supabase-anon-or-service-role-key
   ```
4. Restart the backend — it will automatically read from and write to your live Supabase cloud database!
