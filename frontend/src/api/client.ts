const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface MCPTool {
  id: string
  mcp_server_id: string
  name: string
  description: string
  input_schema: Record<string, unknown>
  permission_level: 'read' | 'write' | 'destructive'
}

export interface MCPServer {
  id: string
  name: string
  description: string
  transport: 'http' | 'stdio' | 'sse'
  endpoint: string
  auth_type: 'none' | 'api_key' | 'oauth'
  status: 'healthy' | 'degraded' | 'dead'
  is_shared: boolean
  last_checked_at: string | null
  created_at: string
  tools: MCPTool[]
}

export interface AgentConfig {
  version: string
  agent_id: string
  name: string
  description: string
  created_at: string
  model: { provider: string; model_id: string; temperature: number; max_tokens: number }
  system_prompt: string
  tools: {
    mcp_server_id: string
    mcp_server_name: string
    tool_name: string
    tool_description: string
    permission_level: string
  }[]
  graph: { type: string; checkpointer: boolean }
  metadata: { user_prompt: string; builder_version: string }
}

export interface Agent {
  id: string
  name: string
  description: string
  status: 'draft' | 'live' | 'archived'
  config: AgentConfig
  created_at: string
  api_token: string
}

export interface Connection {
  server_name: string
  status: 'active' | 'revoked'
  created_at: string
  last_used_at: string | null
}

export interface AgentRun {
  id: string
  trigger: string
  status: string
  latency_ms: number
  cost_usd: number
  result: string
  ran_at: string
}

export interface RegisterServerRequest {
  name: string
  description: string
  transport: 'http' | 'stdio' | 'sse'
  endpoint: string
  auth_type: 'none' | 'api_key' | 'oauth'
  is_shared: boolean
  token?: string
}

export interface CreateAgentRequest {
  name: string
  description: string
  system_prompt: string
  model_id: string
  temperature: number
  tool_ids: string[]
  user_prompt: string
  credentials: Record<string, string>
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  getMcpServers: () => req<MCPServer[]>('/mcp/servers'),
  registerServer: (body: RegisterServerRequest) =>
    req<MCPServer>('/mcp/servers', { method: 'POST', body: JSON.stringify(body) }),
  deleteServer: (id: string) =>
    req<void>(`/mcp/servers/${id}`, { method: 'DELETE' }),
  suggestTools: (prompt: string) =>
    req<MCPServer[]>(`/mcp/tools/suggest?prompt=${encodeURIComponent(prompt)}`),
  createAgent: (body: CreateAgentRequest) =>
    req<Agent>('/agents', { method: 'POST', body: JSON.stringify(body) }),
  listAgents: () => req<Agent[]>('/agents'),
  getAgent: (id: string) => req<Agent>(`/agents/${id}`),
  deleteAgent: (id: string) => req<void>(`/agents/${id}`, { method: 'DELETE' }),
  runAgent: (id: string, message: string) =>
    req<{ output: string; agent_id: string }>(`/agents/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  verifyToken: (server: string, token: string) =>
    req<{ ok: boolean; message: string }>('/agents/verify-token', {
      method: 'POST',
      body: JSON.stringify({ server, token }),
    }),
  getCredentialAvailability: (servers: string[]) =>
    req<Record<string, { available: boolean }>>(`/agents/credential-availability?servers=${servers.join(',')}`),
  getCredentialStatus: (agentId: string) =>
    req<Record<string, { ok: boolean; message: string; key: string; last_used?: string | null }>>(`/agents/${agentId}/credential-status`),
  updateCredentials: (agentId: string, server: string, token: string) =>
    req<{ ok: boolean; message: string }>(`/agents/${agentId}/credentials`, {
      method: 'PATCH',
      body: JSON.stringify({ server, token }),
    }),
  revokeCredential: (agentId: string, server: string) =>
    req<void>(`/agents/${agentId}/credentials/${server}`, { method: 'DELETE' }),
  importDiscovery: (body: { server: { name: string; endpoint: string; transport: string }; tools: { name: string; description: string; input_schema: Record<string, unknown> }[]; auth_type?: string; is_shared?: boolean }) =>
    req<MCPServer>('/mcp/servers/import', { method: 'POST', body: JSON.stringify(body) }),
  syncServerTools: (serverId: string, token: string, endpoint?: string) =>
    req<MCPServer>(`/mcp/servers/${serverId}/sync-tools`, {
      method: 'POST',
      body: JSON.stringify({ token, ...(endpoint ? { endpoint } : {}) }),
    }),
  listConnections: () => req<Connection[]>('/connections'),
  addConnection: (server_name: string, token: string) =>
    req<Connection>('/connections', { method: 'POST', body: JSON.stringify({ server_name, token }) }),
  revokeConnection: (server_name: string) =>
    req<void>(`/connections/${server_name}`, { method: 'DELETE' }),
  listRuns: (agentId: string) => req<AgentRun[]>(`/agents/${agentId}/runs`),
  downloadPostman: (agentId: string, token: string): Promise<Blob> =>
    fetch(`${BASE}/v1/agents/${agentId}/postman`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }).then((r) => r.blob()),
}
