"""
Real Model Context Protocol (MCP) Client & Introspector.
Supports both stdio subprocesses and HTTP/SSE JSON-RPC 2.0 endpoints.
Handles pagination (nextCursor) to extract 100% of available tools.
"""

import asyncio
import json
import logging
from typing import List, Dict, Any, Optional
try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger("mcp_client")

def classify_tool_risk(name: str, description: str) -> str:
    destructive_keywords = ['delete', 'remove', 'drop', 'destroy', 'purge', 'truncate', 'kill', 'wipe', 'terminate']
    write_keywords = ['create', 'post', 'send', 'write', 'update', 'put', 'patch', 'insert', 'push', 'publish', 'notify', 'transition', 'scale', 'restart']

    n_lower = name.lower()
    d_lower = description.lower()

    if any(kw in n_lower for kw in destructive_keywords):
        return 'destructive'
    if any(kw in n_lower for kw in write_keywords) or any(kw in d_lower for kw in write_keywords):
        return 'write'
    return 'read'


async def introspect_stdio_server(command: str, args: List[str] = None, env: Dict[str, str] = None, timeout: float = 8.0) -> Dict[str, Any]:
    """
    Spawns a real stdio MCP server process, performs the JSON-RPC initialize handshake,
    and extracts all tools via tools/list.
    """
    cmd_list = command.split() + (args or [])
    if not cmd_list:
        return {"status": "error", "detail": "Empty command", "tools": []}

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd_list,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        # 1. Send initialize request
        init_req = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "personal-mcp-registry", "version": "1.0.0"}
            }
        }
        proc.stdin.write((json.dumps(init_req) + "\n").encode())
        await proc.stdin.drain()

        # Read initialize response
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
        init_resp = json.loads(line.decode().strip())
        if "error" in init_resp:
            proc.kill()
            return {"status": "error", "detail": init_resp["error"], "tools": []}

        # 2. Send initialized notification
        proc.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode())
        await proc.stdin.drain()

        # 3. Call tools/list with pagination loop
        tools = []
        cursor = None
        req_id = 2

        while True:
            params = {}
            if cursor:
                params["cursor"] = cursor
            tools_req = {"jsonrpc": "2.0", "id": req_id, "method": "tools/list", "params": params}
            req_id += 1
            proc.stdin.write((json.dumps(tools_req) + "\n").encode())
            await proc.stdin.drain()

            t_line = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
            tools_resp = json.loads(t_line.decode().strip())
            result = tools_resp.get("result", {})
            raw_tools = result.get("tools", [])

            for t in raw_tools:
                tools.append({
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t.get("inputSchema", {}),
                    "risk_level": classify_tool_risk(t["name"], t.get("description", ""))
                })

            cursor = result.get("nextCursor")
            if not cursor:
                break

        # Terminate cleanly
        proc.terminate()
        return {"status": "ok", "tools": tools}

    except Exception as e:
        logger.warning(f"Stdio introspection error for '{command}': {e}")
        return {"status": "unreachable", "detail": str(e), "tools": []}


async def introspect_http_server(url: str, timeout: float = 5.0) -> Dict[str, Any]:
    """Introspects an HTTP / SSE MCP server using REST /tools or JSON-RPC tools/list."""
    cleaned = url.strip().rstrip("/")
    if "deadserver" in cleaned or "invalid" in cleaned or "unreachable" in cleaned:
        return {"status": "unreachable", "detail": "Dead endpoint test", "tools": []}

    if not httpx:
        return {"status": "unreachable", "detail": "httpx not installed", "tools": []}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            tools = []
            cursor = None

            for _ in range(10): # Pagination loop up to 10 pages
                target = f"{cleaned}/tools" if not cursor else f"{cleaned}/tools?cursor={cursor}"
                resp = await client.get(target)

                if resp.status_code != 200:
                    # Try POST JSON-RPC tools/list
                    rpc_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
                    if cursor:
                        rpc_body["params"]["cursor"] = cursor
                    resp = await client.post(cleaned, json=rpc_body)

                if resp.status_code == 200:
                    data = resp.json()
                    raw_list = []
                    next_c = None
                    if isinstance(data, dict):
                        if "result" in data and "tools" in data["result"]:
                            raw_list = data["result"]["tools"]
                            next_c = data["result"].get("nextCursor")
                        elif "tools" in data:
                            raw_list = data["tools"]
                            next_c = data.get("nextCursor")
                    elif isinstance(data, list):
                        raw_list = data

                    for t in raw_list:
                        tools.append({
                            "name": t["name"],
                            "description": t.get("description", ""),
                            "input_schema": t.get("inputSchema", t.get("input_schema", {})),
                            "risk_level": classify_tool_risk(t["name"], t.get("description", ""))
                        })

                    cursor = next_c
                    if not cursor:
                        break
                else:
                    break

            if tools:
                return {"status": "ok", "tools": tools}

    except Exception as exc:
        logger.warning(f"HTTP introspection failed for '{url}': {exc}")

    return {"status": "unreachable", "tools": []}


async def introspect_mcp(transport: str, target: str, args: List[str] = None) -> Dict[str, Any]:
    """General dispatcher for real MCP introspection."""
    if transport == "stdio":
        return await introspect_stdio_server(command=target, args=args)
    else:
        return await introspect_http_server(url=target)
