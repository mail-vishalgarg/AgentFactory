const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const TOKEN_KEY = 'af_token'
let authToken: string | null = localStorage.getItem(TOKEN_KEY)
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null) {
  authToken = token
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getAuthToken(): string | null {
  return authToken
}

export function registerUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

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
  connected: boolean
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

export interface AuthUser {
  id: string
  email: string
  is_admin: boolean
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string') {
      return detail[0].msg
    }
  } catch {
    // response body wasn't JSON — fall through to the generic message
  }
  return `${res.status} ${res.statusText}`
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const message = await extractErrorMessage(res)
    if (res.status === 401) onUnauthorized?.()
    throw new Error(message)
  }
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
  signup: (email: string, password: string) =>
    req<AuthResponse>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => req<AuthUser>('/auth/me'),
  downloadPostman: (agentId: string, token: string): Promise<Blob> =>
    fetch(`${BASE}/v1/agents/${agentId}/postman`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }).then((r) => r.blob()),
}
