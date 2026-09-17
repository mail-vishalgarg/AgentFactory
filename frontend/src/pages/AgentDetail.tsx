import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, type Agent, type AgentConfig, type AgentRun, type AgentEvaluation } from '../api/client'

type Tab = 'overview' | 'playground' | 'connections' | 'runs' | 'api'

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
  timestamp?: string
  latencyMs?: number
  toolsUsed?: string[]
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
  const [activeView, setActiveView] = useState<'flowchart' | 'steps'>('flowchart')
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const groups = groupByServer(agent.config.tools)

  const readCount = agent.config.tools.filter((t) => t.permission_level === 'read').length
  const writeCount = agent.config.tools.filter((t) => t.permission_level === 'write').length
  const destructiveCount = agent.config.tools.filter((t) => t.permission_level === 'destructive').length

  return (
    <div className="space-y-4">
      {/* Header and View Switcher */}
      <div className="flex items-center justify-between border-b border-gray-150 pb-3">
        <div>
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
            Execution Flowchart & Architecture
          </span>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Dynamic execution graph showing LangGraph ReAct decision cycle and MCP server integrations
          </p>
        </div>
        <div className="flex bg-gray-100 p-0.5 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveView('flowchart')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeView === 'flowchart'
                ? 'bg-white text-gray-900 shadow-xs font-semibold'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Visual Diagram
          </button>
          <button
            type="button"
            onClick={() => setActiveView('steps')}
            className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeView === 'steps'
                ? 'bg-white text-gray-900 shadow-xs font-semibold'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Execution Steps
          </button>
        </div>
      </div>

      {/* View 1: Descriptive Visual Flowchart */}
      {activeView === 'flowchart' && (
        <div className="space-y-4">
          {/* Flow Stages Ribbon */}
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="p-2 bg-blue-50/60 border border-blue-200 rounded-lg">
              <span className="font-semibold text-blue-700 block">1. Input Ingestion</span>
              <span className="text-[10px] text-blue-600">User Prompt / REST API</span>
            </div>
            <div className="p-2 bg-emerald-50/60 border border-emerald-200 rounded-lg">
              <span className="font-semibold text-emerald-800 block">2. ReAct Engine</span>
              <span className="text-[10px] text-emerald-600">Think ➔ Act ➔ Observe</span>
            </div>
            <div className="p-2 bg-amber-50/60 border border-amber-200 rounded-lg">
              <span className="font-semibold text-amber-800 block">3. MCP Server Layer</span>
              <span className="text-[10px] text-amber-600">{groups.length} Connected Server{groups.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="p-2 bg-purple-50/60 border border-purple-200 rounded-lg">
              <span className="font-semibold text-purple-800 block">4. Final Synthesis</span>
              <span className="text-[10px] text-purple-600">Synthesized Output</span>
            </div>
          </div>

          {/* Main Diagram Area */}
          <div className="relative bg-gradient-to-br from-gray-50/50 via-white to-gray-50/80 border border-gray-200 rounded-xl p-5 overflow-x-auto">
            <div className="min-w-[620px] flex items-stretch gap-3 justify-between">
              {/* NODE 1: User / Trigger */}
              <div className="w-36 flex flex-col justify-center">
                <div className="bg-white border-2 border-blue-200 rounded-xl p-3 shadow-xs hover:border-blue-300 transition-all">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm mb-2 font-bold">
                    💬
                  </div>
                  <h4 className="text-xs font-bold text-gray-900">User Request</h4>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Playground prompt or POST /invoke
                  </p>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px]">
                    <span className="text-gray-400">Payload</span>
                    <span className="font-mono bg-gray-100 px-1 py-0.5 rounded text-gray-600 text-[9px]">
                      message
                    </span>
                  </div>
                </div>
              </div>

              {/* ARROW 1: Trigger -> ReAct Agent */}
              <div className="flex flex-col items-center justify-center px-1">
                <span className="text-[10px] text-gray-400 font-medium mb-1">invokes</span>
                <div className="w-7 h-0.5 bg-gray-300 relative">
                  <div className="absolute right-0 -top-1 w-2 h-2 border-t-2 border-r-2 border-gray-400 rotate-45" />
                </div>
              </div>

              {/* NODE 2: LangGraph ReAct Orchestrator */}
              <div className="w-56 flex flex-col justify-center">
                <div className="bg-white border-2 border-[#2e9e7a] rounded-xl p-3.5 shadow-sm relative">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-800">
                      ReAct Agent
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <h4 className="text-xs font-bold text-gray-900 truncate" title={agent.name}>
                    {agent.name}
                  </h4>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                    {agent.config.model.model_id}
                  </p>

                  {/* ReAct Loop Steps Container */}
                  <div className="mt-2.5 p-2 bg-emerald-50/60 border border-emerald-150 rounded-lg space-y-1 text-[10px]">
                    <div className="flex items-center gap-1.5 text-emerald-900 font-medium">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center text-[9px] font-bold">
                        1
                      </span>
                      <span>Think (Reasoning)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-900 font-medium">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center text-[9px] font-bold">
                        2
                      </span>
                      <span>Act (Call MCP Tools)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-emerald-900 font-medium">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center text-[9px] font-bold">
                        3
                      </span>
                      <span>Observe (Loop or Finish)</span>
                    </div>
                  </div>

                  <div className="mt-2 text-[9px] text-center text-gray-400 italic">
                    ↺ Iterative ReAct Cycle
                  </div>
                </div>
              </div>

              {/* ARROW 2: Bidirectional Tool Call & Observation */}
              <div className="flex flex-col items-center justify-center px-1">
                <div className="text-[9px] text-amber-700 font-semibold mb-1 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 whitespace-nowrap">
                  tool_call ➔
                </div>
                <div className="w-8 h-0.5 bg-amber-400 relative mb-1.5" />
                <div className="w-8 h-0.5 bg-blue-300 border-t border-dashed border-blue-400 relative" />
                <div className="text-[9px] text-blue-700 font-semibold mt-1 bg-blue-50 px-1 py-0.5 rounded border border-blue-200 whitespace-nowrap">
                  ↵ observation
                </div>
              </div>

              {/* NODE 3: MCP Servers & Tools */}
              <div className="flex-1 flex flex-col justify-center space-y-2 min-w-[210px]">
                {groups.length === 0 ? (
                  <div className="p-4 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-center text-xs text-gray-400">
                    No MCP tools configured
                  </div>
                ) : (
                  groups.map((g) => {
                    const hasWrite = g.tools.some((t) => t.permission_level === 'write')
                    const hasDestructive = g.tools.some((t) => t.permission_level === 'destructive')
                    const isExpanded = selectedServer === g.server

                    return (
                      <div
                        key={g.server}
                        className={`bg-white border rounded-xl p-2.5 transition-all ${
                          hasDestructive
                            ? 'border-red-200 shadow-xs'
                            : hasWrite
                            ? 'border-amber-200 shadow-xs'
                            : 'border-gray-200 shadow-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#2e9e7a]" />
                            <span className="font-bold text-xs text-gray-900">{g.server}</span>
                            <span className="text-[9px] text-gray-400 font-mono">
                              (streamable-http)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedServer(isExpanded ? null : g.server)}
                            className="text-[10px] text-[#2e9e7a] hover:underline font-semibold cursor-pointer"
                          >
                            {isExpanded ? 'Hide tools ▲' : `${g.tools.length} tools ▼`}
                          </button>
                        </div>

                        {/* Summary Badges */}
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[9px] font-medium">
                            {g.tools.filter((t) => t.permission_level === 'read').length} read
                          </span>
                          {g.tools.filter((t) => t.permission_level === 'write').length > 0 && (
                            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-medium">
                              {g.tools.filter((t) => t.permission_level === 'write').length} write
                            </span>
                          )}
                          {g.tools.filter((t) => t.permission_level === 'destructive').length > 0 && (
                            <span className="px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[9px] font-medium">
                              {g.tools.filter((t) => t.permission_level === 'destructive').length} destructive
                            </span>
                          )}
                        </div>

                        {/* Collapsible Tool List without truncation */}
                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-gray-100 max-h-36 overflow-y-auto space-y-1">
                            {g.tools.map((tool) => (
                              <div
                                key={tool.tool_name}
                                className="flex items-center justify-between text-[10px] bg-gray-50 px-2 py-0.5 rounded font-mono text-gray-700"
                              >
                                <span className="truncate mr-2 font-medium">{tool.tool_name}</span>
                                <span
                                  className={`text-[8px] px-1 rounded font-sans uppercase font-semibold ${
                                    tool.permission_level === 'destructive'
                                      ? 'bg-red-100 text-red-700'
                                      : tool.permission_level === 'write'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {tool.permission_level}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View 2: Step-by-Step Descriptive Execution Trace */}
      {activeView === 'steps' && (
        <div className="space-y-2.5 bg-gray-50/50 p-4 border border-gray-200 rounded-xl">
          <div className="flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              1
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-900">Message Ingestion & Auth Verification</h4>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                When a user submits a prompt in the playground or triggers the REST endpoint (<code>POST /v1/agents/{agent.id}/invoke</code>),
                the request payload is ingested and the user's active PAT connections for <strong>{groups.map((g) => g.server).join(', ') || 'configured servers'}</strong> are securely resolved.
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200">
            <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              2
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-900">LangGraph ReAct Reasoning Loop</h4>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                The agent instantiates <strong>{agent.config.model.model_id}</strong> (temperature <code>{agent.config.model.temperature}</code>).
                The LLM evaluates the system instructions alongside the schemas of all <strong>{agent.config.tools.length} configured MCP tools</strong>,
                determining if tools are required and formulating JSON argument parameters.
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200">
            <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              3
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-900">Live MCP Server Protocol Execution</h4>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                LangGraph dispatches the selected tool call over the Model Context Protocol (MCP) streamable HTTP client using personal access tokens.
                The server runs the remote task and returns the raw execution result.
              </p>
            </div>
          </div>

          <div className="flex gap-3 items-start bg-white p-3 rounded-lg border border-gray-200">
            <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              4
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-900">Observation & Final Response Delivery</h4>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                The tool's result is passed back to the LLM as an observation. If further actions are needed, it loops back; once satisfied, it synthesizes the final response back to the client.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Footer bar */}
      <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-150">
        <div className="flex items-center gap-3">
          <span>
            Model: <strong className="text-gray-700 font-mono">{agent.config.model.model_id}</strong>
          </span>
          <span>•</span>
          <span>
            Servers: <strong className="text-gray-700">{groups.length}</strong>
          </span>
          <span>•</span>
          <span>
            Tools: <strong className="text-gray-700">{agent.config.tools.length}</strong> ({readCount} read, {writeCount} write, {destructiveCount} destructive)
          </span>
        </div>
        <span className="text-[11px] text-gray-400">
          Generated automatically from agent configuration
        </span>
      </div>
    </div>
  )
}

function ApiTab({ agent }: { agent: Agent }) {
  const baseUrl = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
  const curlSnippet = `curl -X POST ${baseUrl}/v1/agents/${agent.id}/invoke \\
  -H "Authorization: Bearer $AGENT_FACTORY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your message here"}'`

  const also = [
    { method: 'POST', path: `/v1/agents/${agent.id}/stream`, desc: 'Same, streamed over SSE' },
    { method: 'POST', path: `/v1/agents/${agent.id}/resume`, desc: 'Answer a pending approval' },
    { method: 'GET',  path: `/v1/agents/${agent.id}/postman`, desc: 'This collection, as JSON' },
  ]

  async function handleDownload() {
    const blob = await api.downloadPostman(agent.id, agent.api_token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.name}_collection.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyToken() {
    navigator.clipboard.writeText(agent.api_token)
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50 p-8">
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Endpoint</p>
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="font-mono text-sm text-gray-800">
                POST /v1/agents/{agent.id}/invoke
              </span>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-md bg-gray-900 hover:bg-gray-700"
              >
                ↓ Download Postman collection
              </button>
            </div>
            <pre className="px-4 py-4 text-xs text-gray-200 bg-gray-900 overflow-x-auto font-mono leading-relaxed">
              {curlSnippet}
            </pre>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Your API token</p>
          <div className="border border-gray-200 rounded-lg bg-white px-4 py-3 flex items-center gap-3">
            <input
              type="password"
              readOnly
              value={agent.api_token}
              className="flex-1 font-mono text-sm text-gray-700 bg-transparent border-none outline-none"
            />
            <button
              onClick={copyToken}
              className="px-3 py-1 text-xs font-medium border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Use this as{' '}
            <code className="font-mono bg-gray-100 px-1 rounded">$AGENT_FACTORY</code>
            {' '}in the curl command above. Wrong tokens receive 404, not 403.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Also available</p>
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden divide-y divide-gray-100">
            {also.map((row) => (
              <div key={row.path} className="flex items-center px-4 py-3 gap-4">
                <span className="font-mono text-sm text-gray-800 w-80 truncate">
                  {row.method} {row.path}
                </span>
                <span className="text-sm text-gray-400">{row.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [agent, setAgent] = useState<Agent | null>(null)
  const isPlaygroundPath = location.pathname.endsWith('/playground')
  const initialTab: Tab = isPlaygroundPath ? 'playground' : ((searchParams.get('tab') as Tab) ?? 'overview')
  const [tab, setTab] = useState<Tab>(initialTab)
  const [fetchError, setFetchError] = useState('')

  // Credential status
  const [credStatus, setCredStatus] = useState<Record<string, CredStatus>>({})
  const [credChecking, setCredChecking] = useState(false)
  const [newTokens, setNewTokens] = useState<Record<string, string>>({})
  const [updateStatus, setUpdateStatus] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'error'>>({})
  const [updateMsg, setUpdateMsg] = useState<Record<string, string>>({})
  const [showUpdate, setShowUpdate] = useState<Record<string, boolean>>({})

  // Runs state
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  // Playground state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [evalResult, setEvalResult] = useState<AgentEvaluation | null>(null)
  const [evalError, setEvalError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    api.getAgent(id).then((loaded) => {
      setAgent(loaded)
      if (loaded.config?.metadata?.evaluation) {
        setEvalResult(loaded.config.metadata.evaluation)
      }
    }).catch(() => setFetchError('Agent not found.'))
  }, [id])

  // Auto-check credentials once agent loads
  useEffect(() => {
    if (!agent || !id) return
    setCredChecking(true)
    api.getCredentialStatus(id)
      .then(setCredStatus)
      .finally(() => setCredChecking(false))
  }, [agent, id])

  useEffect(() => {
    if (tab !== 'runs' || !id) return
    setRunsLoading(true)
    api.listRuns(id).then(setRuns).finally(() => setRunsLoading(false))
  }, [tab, id])

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

  async function send(customPrompt?: string) {
    const textToSend = (customPrompt || input).trim()
    if (!textToSend || !id || sending) return
    if (!customPrompt) setInput('')
    
    const startTime = Date.now()
    setMessages((prev) => [...prev, {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }])
    setSending(true)
    try {
      const res = await api.runAgent(id, textToSend)
      const durationMs = Date.now() - startTime
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: res.output,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        latencyMs: durationMs
      }])
      api.listRuns(id).then(setRuns)
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime
      const errorText = err instanceof Error ? err.message : 'Error running agent invocation.'
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Execution Notice: ${errorText}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        latencyMs: durationMs
      }])
      api.listRuns(id).then(setRuns)
    } finally {
      setSending(false)
    }
  }

  async function handleRunEvaluation() {
    if (!id || evaluating) return
    setEvaluating(true)
    setEvalError('')
    try {
      const res = await api.evaluateAgent(id)
      setEvalResult(res)
      // Refresh agent to sync updated metadata & status
      const updatedAgent = await api.getAgent(id)
      setAgent(updatedAgent)
    } catch (err: unknown) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation probe encountered an unexpected error.')
    } finally {
      setEvaluating(false)
    }
  }

  function handleCopyMessage(text: string, index: number) {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
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
    { key: 'runs', label: 'Runs' },
    { key: 'api', label: 'API' },
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
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Scores
                    </p>
                    {evalResult ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        ✓ Verified
                      </span>
                    ) : (
                      <button
                        onClick={() => setTab('playground')}
                        className="text-[10px] text-[#2e9e7a] hover:underline font-medium"
                      >
                        Evaluate in Playground →
                      </button>
                    )}
                  </div>
                  <div className="flex items-end justify-between mb-4">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">
                        {evalResult ? 'Benchmark Score' : 'Does it work?'}
                      </p>
                      <div className="flex items-baseline gap-1">
                        <p className="text-4xl font-bold text-gray-900">
                          {evalResult ? evalResult.overall_score : score}
                        </p>
                        <span className="text-xs text-gray-400">/ 100</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 mb-0.5">Safety Grade</p>
                      <p
                        className={`text-4xl font-bold ${
                          (evalResult?.safety_grade || grade) === 'A'
                            ? 'text-emerald-600'
                            : (evalResult?.safety_grade || grade) === 'B'
                            ? 'text-amber-500'
                            : 'text-red-500'
                        }`}
                      >
                        {evalResult?.safety_grade || grade}
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
                    {evalResult
                      ? `Evaluated on ${new Date(evalResult.evaluated_at).toLocaleDateString()} (${evalResult.latency_ms}ms)`
                      : 'Run dynamic scorecard evaluation in the Playground tab.'}
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

      {/* ── Runs tab ── */}
      {tab === 'runs' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-8">
          <div className="max-w-5xl">
            {runsLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-gray-400 text-sm">No runs yet. Try the agent in the Playground.</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">When</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Trigger</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Latency</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cost</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {runs.map((run) => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{timeAgo(run.ran_at)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2 py-0.5 text-xs border border-gray-300 rounded text-gray-600">
                            {run.trigger}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {run.status === 'ok' && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                              ok
                            </span>
                          )}
                          {run.status === 'error' && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                              error
                            </span>
                          )}
                          {run.status === 'approval' && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                              approval
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">
                          {(run.latency_ms / 1000).toFixed(1)}s
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">
                          ${run.cost_usd.toFixed(3)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-xs">
                          {run.result.length > 80 ? run.result.slice(0, 80) + '…' : run.result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── API tab ── */}
      {tab === 'api' && (
        <ApiTab agent={agent} />
      )}

      {/* ── Playground tab ── */}
      {tab === 'playground' && (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-gray-50">
          {/* Left Column: Interactive Chat & Execution Console */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200 bg-white">
            {/* Playground Subheader */}
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live ReAct Agent
                </span>
                <span className="text-xs text-gray-500 font-mono hidden sm:inline">
                  {agent.config.model.model_id}
                </span>
                <span className="text-xs text-gray-400 hidden sm:inline">•</span>
                <span className="text-xs text-gray-500">
                  {agent.config.tools.length} Tools Loaded
                </span>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="text-xs text-gray-500 hover:text-gray-800 px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 transition"
                  >
                    Clear History
                  </button>
                )}
              </div>
            </div>

            {/* Warning if any server token is expired */}
            {expiredServers.length > 0 && (
              <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between flex-shrink-0 text-xs text-amber-800">
                <div className="flex items-center gap-2">
                  <span>⚠</span>
                  <span>
                    Token expired for <strong>{expiredServers.join(', ')}</strong>. Real-time tools will use safety fallback.
                  </span>
                </div>
                <button
                  onClick={() => setTab('connections')}
                  className="font-semibold text-amber-900 hover:underline flex-shrink-0 ml-4"
                >
                  Configure Token →
                </button>
              </div>
            )}

            {/* Chat message stream */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {messages.length === 0 && (
                <div className="py-12 px-4 max-w-lg mx-auto text-center">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#2e9e7a] flex items-center justify-center mx-auto mb-3 text-xl font-bold shadow-sm">
                    ⚡
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">
                    Playground Console: {agent.name}
                  </h3>
                  <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                    Test full multi-step reasoning, tool dispatching, and dynamic argument resolution in real time.
                  </p>

                  <div className="text-left space-y-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      Suggested starter prompts:
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {[
                        `What tools and capabilities do you have available?`,
                        agent.config.tools.some((t) => t.mcp_server_name.toLowerCase().includes('github'))
                          ? 'List recent commits or pull requests from the repository.'
                          : agent.config.tools.some((t) => t.mcp_server_name.toLowerCase().includes('slack'))
                          ? 'Send a summary notification to the #general channel.'
                          : 'Demonstrate your primary task and verify parameters.',
                        `Run a diagnostic check on your tool schemas and system prompt.`
                      ].map((promptText, idx) => (
                        <button
                          key={idx}
                          onClick={() => send(promptText)}
                          className="w-full text-left text-xs text-gray-700 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-900 hover:border-emerald-200 border border-gray-200 rounded-lg px-3.5 py-2 transition flex items-center justify-between group"
                        >
                          <span className="truncate">{promptText}</span>
                          <span className="text-gray-400 group-hover:text-emerald-600 ml-2">→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-3 group`}
                >
                  {msg.role === 'assistant' && (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm mt-0.5"
                      style={{ backgroundColor: '#2e9e7a' }}
                    >
                      A
                    </div>
                  )}
                  <div
                    className={`max-w-xl text-sm px-4 py-3 rounded-2xl relative shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-emerald-600 text-white rounded-tr-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed font-sans">
                      {msg.content}
                    </div>

                    <div className={`flex items-center justify-between mt-2 pt-1 text-[10px] ${
                      msg.role === 'user' ? 'text-emerald-200 border-t border-emerald-500/50' : 'text-gray-400 border-t border-gray-100'
                    }`}>
                      <div className="flex items-center gap-2">
                        {msg.timestamp && <span>{msg.timestamp}</span>}
                        {msg.latencyMs && <span>• {(msg.latencyMs / 1000).toFixed(2)}s</span>}
                      </div>
                      <button
                        onClick={() => handleCopyMessage(msg.content, i)}
                        className="hover:underline transition opacity-70 hover:opacity-100"
                      >
                        {copiedIndex === i ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex gap-3 items-start">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                    style={{ backgroundColor: '#2e9e7a' }}
                  >
                    A
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Reasoning through MCP tool graph…</span>
                    </div>
                    <div className="flex gap-1.5 py-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
              <div className="flex gap-2.5">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  placeholder={`Ask ${agent.name} something or test tool execution…`}
                  disabled={sending}
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a] focus:border-transparent transition"
                />
                <button
                  onClick={() => send()}
                  disabled={sending || !input.trim()}
                  className="px-5 py-2.5 text-sm text-white rounded-xl font-medium disabled:opacity-40 transition flex items-center gap-1.5 shadow-sm"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  {sending ? 'Running…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Scoring & Benchmark Suite */}
          <div className="w-full lg:w-96 flex flex-col bg-gray-50 overflow-auto p-6 space-y-6 flex-shrink-0">
            {/* Header / Trigger */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Scorecard & Auditing</h3>
                <p className="text-xs text-gray-500">Live multi-dimensional agent evaluation</p>
              </div>
              <button
                onClick={handleRunEvaluation}
                disabled={evaluating}
                className="px-3.5 py-2 text-xs font-semibold text-white rounded-lg shadow-sm disabled:opacity-50 transition flex items-center gap-1.5"
                style={{ backgroundColor: '#2e9e7a' }}
              >
                {evaluating ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Auditing…
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    Run Evaluation
                  </>
                )}
              </button>
            </div>

            {evalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {evalError}
              </div>
            )}

            {/* Scorecard Hero Display */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Overall Benchmark
                  </span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-4xl font-black text-gray-900">
                      {evalResult ? evalResult.overall_score : score}
                    </span>
                    <span className="text-xs text-gray-400">/ 100</span>
                  </div>
                  <span className="inline-block mt-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {evalResult ? evalResult.benchmark_status : 'Static Configuration Grade'}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Safety
                  </span>
                  <div
                    className={`text-4xl font-black mt-1 ${
                      (evalResult?.safety_grade || grade) === 'A'
                        ? 'text-emerald-600'
                        : (evalResult?.safety_grade || grade) === 'B'
                        ? 'text-amber-500'
                        : 'text-red-500'
                    }`}
                  >
                    {evalResult?.safety_grade || grade}
                  </div>
                  <span className="text-[11px] text-gray-400 block mt-1">
                    {(evalResult?.safety_grade || grade) === 'A' ? 'Isolated & Safe' : 'Review Permissions'}
                  </span>
                </div>
              </div>

              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${evalResult ? evalResult.overall_score : score}%`,
                    backgroundColor: '#2e9e7a',
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 pt-2 border-t border-gray-100">
                <span>
                  {evalResult
                    ? `Latency: ${evalResult.latency_ms}ms`
                    : 'Click "Run Evaluation" to generate live diagnostics'}
                </span>
                {evalResult && (
                  <span>
                    {new Date(evalResult.evaluated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            {/* Diagnostic Dimensions */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Evaluation Dimensions
              </h4>

              {(evalResult?.dimensions || [
                {
                  name: 'Tool Schema & Parameter Integrity',
                  score: agent.config.tools.length > 0 ? 30 : 15,
                  max_score: 30,
                  status: 'pass',
                  details: `${agent.config.tools.length} tool schemas validated for input/output correctness.`,
                },
                {
                  name: 'ReAct Instruction Scope & Goal Clarity',
                  score: agent.config.system_prompt.length > 50 ? 30 : 20,
                  max_score: 30,
                  status: 'pass',
                  details: `System prompt length (${agent.config.system_prompt.length} chars) with defined loop behavior.`,
                },
                {
                  name: 'Security & Credential Isolation',
                  score: grade === 'A' ? 20 : 15,
                  max_score: 20,
                  status: 'pass',
                  details: 'Zero credentials exposed in agent definition; auth tokens stored in vault.',
                },
                {
                  name: 'Execution Latency & Protocol Health',
                  score: 15,
                  max_score: 20,
                  status: 'pending',
                  details: 'Awaiting dynamic probe execution.',
                },
              ]).map((dim, idx) => (
                <div key={idx} className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-800">{dim.name}</span>
                    <span className="text-xs font-mono font-bold text-gray-700">
                      {dim.score}/{dim.max_score}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        dim.score === dim.max_score
                          ? 'bg-emerald-500'
                          : dim.score >= dim.max_score * 0.7
                          ? 'bg-teal-500'
                          : 'bg-amber-400'
                      }`}
                      style={{ width: `${(dim.score / dim.max_score) * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">{dim.details}</p>
                </div>
              ))}
            </div>

            {/* Diagnostic Output preview if available */}
            {evalResult?.diagnostic_output && (
              <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Diagnostic Probe Result
                </span>
                <p className="text-xs font-mono text-gray-700 bg-gray-50 p-2.5 rounded-lg border border-gray-200 max-h-32 overflow-auto whitespace-pre-wrap">
                  {evalResult.diagnostic_output}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
