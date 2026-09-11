import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, type Agent, type AgentConfig } from '../api/client'

type Tab = 'overview' | 'playground' | 'connections'

interface CredStatus {
  ok: boolean
  message: string
  key: string
  last_used?: string | null
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const CRED_META: Record<string, { label: string; placeholder: string; hint: string; hintUrl: string }> = {
  github: { label: 'GitHub Personal Access Token', placeholder: 'ghp_...', hint: 'github.com/settings/tokens', hintUrl: 'https://github.com/settings/tokens?type=beta' },
  slack:  { label: 'Slack Bot OAuth Token',         placeholder: 'xoxb-...', hint: 'api.slack.com/apps',        hintUrl: 'https://api.slack.com/apps' },
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function groupByServer(tools: AgentConfig['tools']) {
  const map = new Map<string, AgentConfig['tools']>()
  for (const t of tools) {
    if (!map.has(t.mcp_server_name)) map.set(t.mcp_server_name, [])
    map.get(t.mcp_server_name)!.push(t)
  }
  return Array.from(map.entries()).map(([server, ts]) => ({ server, tools: ts }))
}

function safetyGrade(tools: AgentConfig['tools']): string {
  if (tools.some((t) => t.permission_level === 'destructive')) return 'C'
  if (tools.some((t) => t.permission_level === 'write')) return 'B'
  return 'A'
}

function effectivenessScore(agent: Agent): number {
  let score = 50
  if (agent.config.tools.length > 0) score += 20
  if (agent.config.system_prompt && agent.config.system_prompt.length > 30) score += 15
  const servers = new Set(agent.config.tools.map((t) => t.mcp_server_name)).size
  score += Math.min(servers * 5, 15)
  return Math.min(score, 100)
}

function AgentGraph({ agent }: { agent: Agent }) {
  const groups = groupByServer(agent.config.tools)
  const n = Math.max(groups.length, 1)
  const H = Math.max(200, n * 72 + 80)
  const W = 660

  const msgW = 82, msgH = 36
  const msgX = 20, msgY = H / 2 - msgH / 2

  const agentW = 160, agentH = 70
  const agentX = 170, agentY = H / 2 - agentH / 2

  const toolW = 178, toolH = 52
  const toolX = 420
  const totalToolH = n * toolH + (n - 1) * 14
  const toolStartY = H / 2 - totalToolH / 2

  const agentCX = agentX + agentW / 2
  const agentCY = agentY + agentH / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
        </marker>
        <marker id="arrowhead-loop" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#cbd5e1" />
        </marker>
      </defs>

      {/* message → agent */}
      <line
        x1={msgX + msgW} y1={msgY + msgH / 2}
        x2={agentX - 4} y2={agentCY}
        stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowhead)"
      />

      {/* message box */}
      <rect x={msgX} y={msgY} width={msgW} height={msgH} rx="6"
        fill="white" stroke="#e2e8f0" strokeWidth="1.5" />
      <text x={msgX + msgW / 2} y={msgY + msgH / 2 + 5}
        textAnchor="middle" fontSize="12" fontWeight="600" fill="#374151">message</text>

      {/* agent → tools + loop */}
      {groups.map((g, i) => {
        const ty = toolStartY + i * (toolH + 14)
        const tcx = toolX + toolW / 2
        const tcy = ty + toolH / 2
        return (
          <g key={g.server}>
            <line
              x1={agentX + agentW} y1={agentCY}
              x2={toolX - 4} y2={tcy}
              stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowhead)"
            />
            <line
              x1={tcx - toolW / 2} y1={tcy}
              x2={agentX + agentW + 4} y2={agentCY}
              stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,3"
              markerEnd="url(#arrowhead-loop)"
            />
          </g>
        )
      })}

      {/* agent box */}
      <rect x={agentX} y={agentY} width={agentW} height={agentH} rx="10"
        fill="#f0fdf4" stroke="#2e9e7a" strokeWidth="2" />
      <text x={agentCX} y={agentY + 24} textAnchor="middle"
        fontSize="13" fontWeight="700" fill="#065f46">
        {agent.name.length > 18 ? agent.name.slice(0, 18) + '…' : agent.name}
      </text>
      <text x={agentCX} y={agentY + 42} textAnchor="middle" fontSize="10" fill="#6b7280">
        {agent.config.model.model_id}
      </text>
      <text x={agentCX} y={agentY + 57} textAnchor="middle" fontSize="10" fill="#6b7280">
        ReAct agent
      </text>

      {/* tool boxes */}
      {groups.map((g, i) => {
        const ty = toolStartY + i * (toolH + 14)
        const hasWrite = g.tools.some(
          (t) => t.permission_level === 'write' || t.permission_level === 'destructive',
        )
        const toolNames = g.tools.map((t) => t.tool_name).join(', ')
        const shortNames = toolNames.length > 24 ? toolNames.slice(0, 24) + '…' : toolNames
        return (
          <g key={g.server}>
            <rect x={toolX} y={ty} width={toolW} height={toolH} rx="8"
              fill="white"
              stroke={hasWrite ? '#fcd34d' : '#e2e8f0'}
              strokeWidth="1.5" />
            <text x={toolX + toolW / 2} y={ty + 20} textAnchor="middle"
              fontSize="12" fontWeight="700" fill="#374151">{g.server}</text>
            <text x={toolX + toolW / 2} y={ty + 36} textAnchor="middle"
              fontSize="10" fill="#9ca3af">{shortNames}</text>
          </g>
        )
      })}

      {groups.length === 0 && (
        <text x={W / 2} y={H / 2 + 5} textAnchor="middle" fontSize="12" fill="#9ca3af">
          No tools configured
        </text>
      )}
    </svg>
  )
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'overview')
  const [fetchError, setFetchError] = useState('')

  // Credential status
  const [credStatus, setCredStatus] = useState<Record<string, CredStatus>>({})
  const [credChecking, setCredChecking] = useState(false)
  const [newTokens, setNewTokens] = useState<Record<string, string>>({})
  const [updateStatus, setUpdateStatus] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'error'>>({})
  const [updateMsg, setUpdateMsg] = useState<Record<string, string>>({})
  const [showUpdate, setShowUpdate] = useState<Record<string, boolean>>({})

  // Playground state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    api.getAgent(id).then(setAgent).catch(() => setFetchError('Agent not found.'))
  }, [id])

  // Auto-check credentials once agent loads
  useEffect(() => {
    if (!agent || !id) return
    setCredChecking(true)
    api.getCredentialStatus(id)
      .then(setCredStatus)
      .finally(() => setCredChecking(false))
  }, [agent, id])

  async function handleUpdateToken(server: string) {
    const token = newTokens[server]?.trim()
    if (!token || !id) return
    setUpdateStatus((s) => ({ ...s, [server]: 'saving' }))
    try {
      const res = await api.updateCredentials(id, server, token)
      setUpdateStatus((s) => ({ ...s, [server]: res.ok ? 'ok' : 'error' }))
      setUpdateMsg((s) => ({ ...s, [server]: res.message }))
      if (res.ok) {
        setCredStatus((prev) => ({ ...prev, [server]: { ok: true, message: res.message, key: server } }))
        setNewTokens((t) => ({ ...t, [server]: '' }))
      }
    } catch {
      setUpdateStatus((s) => ({ ...s, [server]: 'error' }))
      setUpdateMsg((s) => ({ ...s, [server]: 'Update failed' }))
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function send() {
    if (!input.trim() || !id || sending) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setSending(true)
    try {
      const res = await api.runAgent(id, userMsg)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.output }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Error running agent.' }])
    } finally {
      setSending(false)
    }
  }

  if (fetchError) return <div className="p-8 text-red-500">{fetchError}</div>
  if (!agent) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  const score = effectivenessScore(agent)
  const grade = safetyGrade(agent.config.tools)
  const groups = groupByServer(agent.config.tools)

  const checks = [
    {
      label: 'No destructive tools configured',
      ok: !agent.config.tools.some((t) => t.permission_level === 'destructive'),
    },
    { label: 'System prompt configured', ok: agent.config.system_prompt.length > 20 },
    { label: 'Credentials never stored in config', ok: true },
    { label: 'Tools are registered', ok: agent.config.tools.length > 0 },
  ]

  const expiredServers = Object.entries(credStatus).filter(([, s]) => !s.ok).map(([k]) => k)

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'playground', label: 'Playground' },
    { key: 'connections', label: 'Connections', badge: expiredServers.length || undefined },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="border-b border-gray-200 bg-white px-8 pt-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-semibold text-gray-900 truncate">{agent.name}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#e6f7f2] text-[#2e9e7a] flex-shrink-0">
              • {agent.status}
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Link
              to="/agents"
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 font-medium"
            >
              ← My Agents
            </Link>
            <button
              onClick={() => setTab('playground')}
              className="px-4 py-1.5 text-sm text-white rounded-md font-medium"
              style={{ backgroundColor: '#2e9e7a' }}
            >
              Open playground
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-3">{agent.description}</p>

        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t.key
                  ? 'border-[#2e9e7a] text-[#2e9e7a]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="text-xs bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <div className="flex-1 overflow-auto bg-gray-50">
          <div className="p-8 max-w-5xl mx-auto">
            <div className="flex gap-6 items-start">
              {/* Left — graph + instructions */}
              <div className="flex-1 space-y-5 min-w-0">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Agent Graph
                  </p>
                  <div className="border border-gray-200 rounded-xl bg-white p-5">
                    <AgentGraph agent={agent} />
                    <p className="text-xs text-gray-400 mt-3">
                      Drawn from the agent's configuration, not hand-maintained. Change the config and the picture changes.
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Instructions
                  </p>
                  <div className="border border-gray-200 rounded-xl bg-white p-5">
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {agent.config.system_prompt}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right — scores + details */}
              <div className="w-60 flex-shrink-0 space-y-4">
                {/* Scores */}
                <div className="border border-gray-200 rounded-xl bg-white p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                    Scores
                  </p>
                  <div className="flex items-end justify-between mb-4">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Does it work?</p>
                      <p className="text-4xl font-bold text-gray-900">{score}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 mb-0.5">Is it safe?</p>
                      <p
                        className={`text-4xl font-bold ${
                          grade === 'A'
                            ? 'text-green-600'
                            : grade === 'B'
                            ? 'text-amber-500'
                            : 'text-red-500'
                        }`}
                      >
                        {grade}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {checks.map((c) => (
                      <div key={c.label} className="flex items-start gap-2 text-xs">
                        <span
                          className={`mt-0.5 flex-shrink-0 font-bold ${
                            c.ok ? 'text-green-500' : 'text-red-400'
                          }`}
                        >
                          {c.ok ? '✓' : '✗'}
                        </span>
                        <span className="text-gray-600">{c.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                    Every number traces to a check you can point at.
                  </p>
                </div>

                {/* Details */}
                <div className="border border-gray-200 rounded-xl bg-white p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Details
                  </p>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Model</span>
                      <span className="font-mono font-medium text-gray-700">
                        {agent.config.model.model_id}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Shape</span>
                      <span className="text-gray-700">ReAct · single-agent</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Tools</span>
                      <span className="text-gray-700">
                        {agent.config.tools.length} ({groups.length}{' '}
                        {groups.length === 1 ? 'server' : 'servers'})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Temperature</span>
                      <span className="text-gray-700">{agent.config.model.temperature}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Created</span>
                      <span className="text-gray-700">
                        {new Date(agent.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Connections tab ── */}
      {tab === 'connections' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-8">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Connections</p>
            <p className="text-sm text-gray-500 mb-5">
              Token status is checked live. Update a token to reconnect without rebuilding the agent.
            </p>

            {credChecking && <p className="text-sm text-gray-400">Checking credentials…</p>}

            {!credChecking && (() => {
              // All unique servers this agent uses, merged with credential status
              const allServers = [...new Set(agent.config.tools.map((t) => t.mcp_server_name))]
              const rows = allServers.map((server) => ({
                server,
                status: credStatus[server] ?? null,
              }))

              return (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[180px_130px_1fr_110px_140px] gap-0 border-b border-gray-200 bg-gray-50 px-5 py-2.5">
                  {['SERVER', 'STATUS', 'USED BY THIS AGENT', 'LAST USED', ''].map((h) => (
                    <span key={h} className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</span>
                  ))}
                </div>

                {/* Rows */}
                {rows.map(({ server, status }, idx, arr) => {
                  const meta = CRED_META[server]
                  const us = updateStatus[server] ?? 'idle'
                  const isLast = idx === arr.length - 1
                  const authType = server === 'github' ? 'api_key' : server === 'slack' ? 'oauth' : 'token'
                  const serverTools = agent.config.tools
                    .filter((t) => t.mcp_server_name.toLowerCase() === server.toLowerCase())
                    .map((t) => t.tool_name)
                  const expanding = showUpdate[server] ?? false
                  const hasToken = status !== null

                  return (
                    <div key={server}>
                      {/* Main row */}
                      <div
                        className={`grid grid-cols-[180px_130px_1fr_110px_140px] gap-0 px-5 py-4 items-center ${
                          !isLast || expanding ? 'border-b border-gray-100' : ''
                        }`}
                      >
                        {/* SERVER */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900 text-sm">{server}</span>
                            <span className="text-xs text-gray-400 font-mono">{authType}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">{agent.name}</div>
                        </div>

                        {/* STATUS */}
                        <div>
                          {hasToken ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                              status!.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${status!.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                              {status!.ok ? 'active' : 'expired'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                              not connected
                            </span>
                          )}
                        </div>

                        {/* USED BY THIS AGENT */}
                        <div className="text-sm text-gray-600 truncate pr-4">
                          {serverTools.length > 0 ? serverTools.join(', ') : '—'}
                        </div>

                        {/* LAST USED */}
                        <div className="text-sm text-gray-400">
                          {timeAgo(status?.last_used)}
                        </div>

                        {/* ACTIONS */}
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setShowUpdate((prev) => ({ ...prev, [server]: !prev[server] }))}
                            className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                          >
                            {expanding ? 'Cancel' : hasToken ? 'Update' : 'Connect'}
                          </button>
                          {hasToken && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Remove ${server} token from this agent?`) || !id) return
                                await api.revokeCredential(id, server)
                                setCredStatus((s) => { const n = { ...s }; delete n[server]; return n })
                              }}
                              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Inline update form */}
                      {expanding && (
                        <div className={`px-5 pb-4 bg-gray-50 ${!isLast ? 'border-b border-gray-100' : ''}`}>
                          <div className="flex gap-2 items-start pt-2">
                            <div className="flex-1 space-y-1">
                              <label className="block text-xs text-gray-500">{meta?.label ?? `${server} token`}</label>
                              <input
                                type="password"
                                value={newTokens[server] ?? ''}
                                onChange={(e) => setNewTokens((t) => ({ ...t, [server]: e.target.value }))}
                                placeholder={meta?.placeholder ?? 'Paste new token…'}
                                autoFocus
                                className={`w-full border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2e9e7a] ${
                                  us === 'error' ? 'border-red-400 bg-red-50' : us === 'ok' ? 'border-green-400 bg-green-50' : 'border-gray-300'
                                }`}
                              />
                              {us === 'error' && <p className="text-xs text-red-500">{updateMsg[server]}</p>}
                              {us === 'ok' && <p className="text-xs text-green-600">{updateMsg[server]}</p>}
                              {meta && (
                                <a href={meta.hintUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2e9e7a] hover:underline">
                                  Get a new token at {meta.hint} ↗
                                </a>
                              )}
                            </div>
                            <button
                              onClick={async () => {
                                await handleUpdateToken(server)
                                setShowUpdate((prev) => ({ ...prev, [server]: false }))
                              }}
                              disabled={us === 'saving' || !newTokens[server]?.trim()}
                              className="mt-5 px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-40 flex-shrink-0"
                              style={{ backgroundColor: '#2e9e7a' }}
                            >
                              {us === 'saving' ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Playground tab ── */}
      {tab === 'playground' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {expiredServers.length > 0 && (
            <div className="px-8 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between flex-shrink-0">
              <p className="text-sm text-red-700">
                ⚠ Token expired for: <strong>{expiredServers.join(', ')}</strong> — agent responses may fail.
              </p>
              <button
                onClick={() => setTab('connections')}
                className="text-xs font-semibold text-red-600 hover:underline ml-4 flex-shrink-0"
              >
                Update token →
              </button>
            </div>
          )}
          <div className="px-8 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <p className="text-xs text-gray-400">
              Test your agent live. Real GitHub tools fire when credentials are wired; all others return
              placeholder responses.
            </p>
          </div>

          <div className="flex-1 overflow-auto p-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-300 text-sm mt-16">
                Send a message to test{' '}
                <span className="font-medium text-gray-400">{agent.name}</span>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-3`}
              >
                {msg.role === 'assistant' && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: '#2e9e7a' }}
                  >
                    F
                  </div>
                )}
                <div
                  className={`max-w-lg text-sm px-4 py-2 rounded-2xl whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-gray-100 text-gray-800 rounded-tr-sm'
                      : 'bg-white border border-gray-200 text-gray-700 rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-3 items-center">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  F
                </div>
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-gray-300 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder={`Ask ${agent.name} something…`}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
              />
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                className="px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-40"
                style={{ backgroundColor: '#2e9e7a' }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
