// frontend/vite-plugin-mcp.js
// Embeds the complete MCP SQL Registry backend directly into Vite.
// No separate Python / FastAPI / uvicorn process required!

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SQL_SEED_PATH = path.resolve(__dirname, "..", "supabase_seed.sql")

export function parseSqlSeedData() {
  if (!fs.existsSync(SQL_SEED_PATH)) {
    return { servers: [], tools: [] }
  }

  const sql = fs.readFileSync(SQL_SEED_PATH, "utf-8")

  // Parse servers from Section 5: INSERT INTO public.mcp_servers
  const serverRegex = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\[.*?\]|'\[.*?\]')::jsonb,\s*(\{.*?\}|'\{.*?\}')::jsonb,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false)\)/g
  const servers = []
  let match

  while ((match = serverRegex.exec(sql)) !== null) {
    let commandArgs = []
    let envVars = {}
    try {
      const cleanArgs = match[9].replace(/^['"]|['"]$/g, "")
      commandArgs = JSON.parse(cleanArgs)
    } catch {
      commandArgs = []
    }
    try {
      const cleanEnv = match[10].replace(/^['"]|['"]$/g, "")
      envVars = JSON.parse(cleanEnv)
    } catch {
      envVars = {}
    }

    servers.push({
      id: match[1],
      name: match[2],
      display_name: match[3],
      description: match[4],
      category: match[5],
      package_name: match[6],
      transport: match[7],
      command: match[8],
      command_args: commandArgs,
      env_vars: envVars,
      url: match[11],
      auth_type: match[12],
      token_guide: match[13],
      status: match[14],
      connected: match[15] === "true",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  }

  // Parse tools from Section 6 & 7: INSERT INTO public.mcp_tools
  const toolRegex = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'(\{.*?\})'::jsonb\)/g
  const tools = []
  let tMatch

  while ((tMatch = toolRegex.exec(sql)) !== null) {
    let schema = {}
    try {
      schema = JSON.parse(tMatch[6])
    } catch {
      schema = {}
    }
    tools.push({
      id: tMatch[1],
      server_id: tMatch[2],
      name: tMatch[3],
      description: tMatch[4],
      risk_level: tMatch[5],
      input_schema: schema,
      created_at: new Date().toISOString()
    })
  }

  return { servers, tools }
}

export function generateExportConfig(server, format = "claude") {
  const name = server.name || "mcp-server"
  const transport = server.transport || "stdio"
  const command = server.command || ""
  const commandParts = command.split(" ").filter(Boolean)
  const binCmd = commandParts[0] || "npx"
  const defaultArgs = [...commandParts.slice(1), ...(server.command_args || [])]
  const env = server.env_vars || {}
  const url = server.url || "http://localhost:8000"

  if (format === "claude") {
    const configBlock = transport === "stdio" ? {
      mcpServers: {
        [name]: {
          command: binCmd,
          args: defaultArgs,
          env: env
        }
      }
    } : {
      mcpServers: {
        [name]: {
          url: url,
          transport: transport,
          headers: server.auth_type !== "none" ? { Authorization: "Bearer <TOKEN>" } : {}
        }
      }
    }
    return {
      format: "claude",
      filename: "~/Library/Application Support/Claude/claude_desktop_config.json",
      content: JSON.stringify(configBlock, null, 2)
    }
  }

  if (format === "cursor") {
    const cursorBlock = transport === "stdio" ? {
      mcpServers: {
        [name]: {
          command: `${binCmd} ${defaultArgs.join(" ")}`.trim(),
          env: env
        }
      }
    } : {
      mcpServers: {
        [name]: {
          url: url,
          type: transport
        }
      }
    }
    return {
      format: "cursor",
      filename: ".cursor/mcp.json",
      content: JSON.stringify(cursorBlock, null, 2)
    }
  }

  // LangGraph Python snippet
  const codeSnippet = `# LangGraph / LangChain Python MCP Adapter
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "${name}": {
        "command": "${binCmd}",
        "args": ${JSON.stringify(defaultArgs)},
        "transport": "${transport}"
    }
})

# Load all extracted tools from SQL table into your agent
tools = await client.get_tools()
print(f"Loaded {len(tools)} tools from ${server.display_name}")
`
  return {
    format: "langgraph",
    filename: "agent_graph.py",
    content: codeSnippet
  }
}

export default function mcpBackendPlugin() {
  let cachedData = null

  function getData() {
    if (!cachedData || cachedData.servers.length === 0) {
      cachedData = parseSqlSeedData()
    }
    return cachedData
  }

  return {
    name: "vite-plugin-mcp-backend",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parsedUrl = new URL(req.url, "http://localhost:3000")
        const pathname = parsedUrl.pathname
        const query = parsedUrl.searchParams

        // Health check
        if (pathname === "/api/health") {
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ status: "ok", service: "mcp-registry", mode: "fullstack-vite" }))
          return
        }

        // Export config: /api/servers/:id/export
        const exportMatch = pathname.match(/^\/api\/servers\/([^/]+)\/export$/)
        if (exportMatch && req.method === "GET") {
          const serverId = exportMatch[1]
          const format = query.get("format") || "claude"
          const data = getData()
          const s = data.servers.find(srv => srv.id === serverId || srv.name === serverId)
          if (!s) {
            res.statusCode = 404
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ detail: "Server not found" }))
            return
          }
          const result = generateExportConfig(s, format)
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify(result))
          return
        }

        // List & search servers: GET /api/servers
        if (pathname === "/api/servers" && req.method === "GET") {
          const category = query.get("category")
          const search = query.get("search")
          const data = getData()

          let list = data.servers.map(srv => {
            const serverTools = data.tools.filter(t => t.server_id === srv.id)
            return { ...srv, tools: serverTools }
          })

          if (category && category.toLowerCase() !== "all") {
            list = list.filter(s => s.category.toLowerCase() === category.toLowerCase())
          }

          if (search) {
            const q = search.toLowerCase()
            list = list.filter(s =>
              s.name.toLowerCase().includes(q) ||
              s.display_name.toLowerCase().includes(q) ||
              (s.description && s.description.toLowerCase().includes(q))
            )
          }

          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify(list))
          return
        }

        // Register custom server: POST /api/servers
        if (pathname === "/api/servers" && req.method === "POST") {
          let body = ""
          req.on("data", chunk => { body += chunk })
          req.on("end", () => {
            try {
              const payload = JSON.parse(body)
              const data = getData()
              const id = `srv-${payload.name || Date.now()}`
              const newServer = {
                id,
                name: payload.name,
                display_name: payload.display_name || payload.name,
                description: payload.description || "",
                category: payload.category || "Dev Tools",
                package_name: payload.package_name || payload.name,
                transport: payload.transport || "stdio",
                command: payload.command || "",
                command_args: payload.command_args || [],
                env_vars: payload.env_vars || {},
                url: payload.url || "",
                auth_type: payload.auth_type || "none",
                token_guide: payload.token_guide || "",
                status: "ok",
                connected: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                tools: []
              }
              data.servers.unshift(newServer)
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify(newServer))
            } catch (err) {
              res.statusCode = 400
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ detail: "Invalid JSON payload" }))
            }
          })
          return
        }

        // Delete server: DELETE /api/servers/:id
        const deleteMatch = pathname.match(/^\/api\/servers\/([^/]+)$/)
        if (deleteMatch && req.method === "DELETE") {
          const serverId = deleteMatch[1]
          const data = getData()
          data.servers = data.servers.filter(s => s.id !== serverId && s.name !== serverId)
          data.tools = data.tools.filter(t => t.server_id !== serverId)
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ status: "deleted", id: serverId }))
          return
        }

        next()
      })
    }
  }
}
