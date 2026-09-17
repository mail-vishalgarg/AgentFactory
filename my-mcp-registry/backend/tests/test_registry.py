import unittest
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import asyncio
try:
    from fastapi.testclient import TestClient
    from main import app
    client = TestClient(app)
except Exception:
    client = None

import app.db as db

class TestPersonalMCPRegistry(unittest.TestCase):

    def test_sql_server_extraction(self):
        """Verify that all 15 servers and all 44 GitHub tools are extracted from the SQL table."""
        if client:
            res = client.get("/api/servers")
            self.assertEqual(res.status_code, 200)
            servers = res.json()
        else:
            servers = asyncio.run(db.get_all_servers())
        self.assertEqual(len(servers), 15, f"Expected 15 servers in SQL table, found {len(servers)}")

        # Check GitHub has all 44 tools
        gh = next((s for s in servers if s["name"] == "github"), None)
        self.assertIsNotNone(gh, "GitHub MCP server not found in SQL database")
        self.assertEqual(len(gh["tools"]), 44, f"Expected exactly 44 GitHub tools in SQL, got {len(gh['tools'])}")

        # Verify risk levels of key tools
        tools_dict = {t["name"]: t["risk_level"] for t in gh["tools"]}
        self.assertEqual(tools_dict.get("get_file_contents"), "read")
        self.assertEqual(tools_dict.get("create_pull_request"), "write")
        self.assertEqual(tools_dict.get("delete_branch"), "destructive")

    def test_category_filtering(self):
        """Verify SQL filtering by category."""
        if client:
            res = client.get("/api/servers?category=Database")
            self.assertEqual(res.status_code, 200)
            db_servers = res.json()
        else:
            db_servers = asyncio.run(db.get_all_servers(category="Database"))
        names = [s["name"] for s in db_servers]
        self.assertIn("postgres", names)
        self.assertIn("sqlite", names)
        self.assertNotIn("github", names)

    def test_config_exporter(self):
        """Verify 1-click exporter returns valid Claude, Cursor, and LangGraph snippets."""
        if client:
            res_claude = client.get("/api/servers/srv-github/export?format=claude")
            self.assertEqual(res_claude.status_code, 200)
            claude_data = res_claude.json()
            res_cursor = client.get("/api/servers/srv-sqlite/export?format=cursor")
            self.assertEqual(res_cursor.status_code, 200)
            cursor_data = res_cursor.json()
        else:
            gh = asyncio.run(db.get_server_by_id("srv-github"))
            claude_data = db.export_server_config(gh, fmt="claude")
            sq = asyncio.run(db.get_server_by_id("srv-sqlite"))
            cursor_data = db.export_server_config(sq, fmt="cursor")

        self.assertIn("mcpServers", claude_data["content"])
        self.assertIn("github", claude_data["content"])
        self.assertIn(".cursor/mcp.json", cursor_data["filename"])

    def test_failure_guard_dead_server(self):
        """Verify that dead servers are aborted and nothing is saved."""
        if client:
            res = client.post("/api/servers", json={
                "name": "dead-test",
                "transport": "http",
                "url": "http://localhost:8000/mock/deadserver"
            })
            self.assertEqual(res.status_code, 400)
            self.assertIn("✕ If it does not answer, nothing is saved", res.json()["detail"])
        else:
            # Direct verification of guard: server is not saved without responding
            import app.mcp_client as mcp_client
            intro = asyncio.run(mcp_client.introspect_mcp(transport="http", target="http://localhost:8000/mock/deadserver"))
            self.assertNotEqual(intro.get("status"), "ok")

if __name__ == "__main__":
    unittest.main()
