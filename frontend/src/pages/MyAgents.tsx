import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Agent, type AgentRunWithAgent } from '../api/client'

const statusStyle: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  live: 'bg-[#e6f7f2] text-[#2e9e7a]',
  archived: 'bg-yellow-100 text-yellow-700',
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

type Tab = 'agents' | 'runs' | 'api'

const API_BASE = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'

function curlFor(agent: Agent): string {
  return `curl -X POST ${API_BASE}/v1/agents/${agent.id}/invoke \\
  -H "Authorization: Bearer $AGENT_FACTORY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Your message here"}'`
}

export default function MyAgents() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<AgentRunWithAgent[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  function load() {
    setLoading(true)
    api.listAgents().then(setAgents).finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (tab !== 'runs') return
    setRunsLoading(true)
    api.listAllRuns().then(setRuns).finally(() => setRunsLoading(false))
  }, [tab])

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return
    await api.deleteAgent(id)
    load()
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
  }

  async function handleDownloadPostman(agent: Agent) {
    const blob = await api.downloadPostman(agent.id, agent.api_token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.name}_collection.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">My Agents</h1>
        <Link
          to="/build"
          className="px-4 py-2 text-sm text-white rounded-md font-medium"
          style={{ backgroundColor: '#2e9e7a' }}
        >
          + Build new agent
        </Link>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(['agents', 'runs', 'api'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[#2e9e7a] text-[#2e9e7a]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'agents' ? 'Agents' : t === 'runs' ? 'Runs' : 'API'}
          </button>
        ))}
      </div>

      {tab === 'runs' && (
        <div>
          {runsLoading && <p className="text-sm text-gray-400">Loading…</p>}

          {!runsLoading && runs.length === 0 && (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">No runs yet.</p>
              <p className="text-sm mt-1">Runs show up here once you try an agent in its Playground.</p>
            </div>
          )}

          {!runsLoading && runs.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
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
                    <tr
                      key={run.id}
                      onClick={() => navigate(`/agents/${run.agent_id}`)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{run.agent_name}</td>
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
      )}

      {tab === 'api' && (
        <div>
          {loading && <p className="text-sm text-gray-400">Loading…</p>}

          {!loading && agents.length === 0 && (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">No agents yet.</p>
            </div>
          )}

          {!loading && agents.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white divide-y divide-gray-100">
              {agents.map((agent) => (
                <div key={agent.id} className="px-4 py-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{agent.name}</span>
                    <button
                      onClick={() => handleDownloadPostman(agent)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-md bg-gray-900 hover:bg-gray-700"
                    >
                      ↓ Download Postman collection
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-md px-3 py-2">
                    <span className="font-mono text-xs text-gray-700 truncate">
                      POST /v1/agents/{agent.id}/invoke
                    </span>
                    <button
                      onClick={() => copyText(curlFor(agent))}
                      className="shrink-0 px-2 py-1 text-xs font-medium border border-gray-300 rounded text-gray-600 hover:bg-white"
                    >
                      Copy curl
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="password"
                      readOnly
                      value={agent.api_token}
                      className="flex-1 font-mono text-xs text-gray-700 bg-transparent border border-gray-200 rounded-md px-3 py-2 outline-none"
                    />
                    <button
                      onClick={() => copyText(agent.api_token)}
                      className="shrink-0 px-2 py-1 text-xs font-medium border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
                    >
                      Copy token
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'agents' && (
        <>
      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!loading && agents.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No agents yet.</p>
          <Link to="/build" style={{ color: '#2e9e7a' }} className="text-sm font-medium hover:underline">
            Build your first one →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => navigate(`/agents/${agent.id}`)}
            className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900 truncate">{agent.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[agent.status]}`}>
                {agent.status}
              </span>
            </div>

            <p className="text-sm text-gray-500 line-clamp-2">{agent.description}</p>

            <div className="flex gap-3 text-xs text-gray-400">
              <span>{agent.config.tools.length} tools</span>
              <span>{agent.config.model.model_id}</span>
              <span>{new Date(agent.created_at).toLocaleDateString()}</span>
            </div>

            <div className="flex flex-wrap gap-1">
              {agent.config.tools.slice(0, 3).map((t) => (
                <span key={`${t.mcp_server_name}.${t.tool_name}`} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                  {t.mcp_server_name}.{t.tool_name}
                </span>
              ))}
              {agent.config.tools.length > 3 && (
                <span className="text-xs text-gray-400">+{agent.config.tools.length - 3} more</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              {agent.last_run_status ? (
                <>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      agent.last_run_status === 'ok' ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full inline-block ${
                        agent.last_run_status === 'ok' ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    {agent.last_run_status}
                  </span>
                  <span className="text-gray-400">{timeAgo(agent.last_run_at as string)}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400">
                    {agent.run_count} run{agent.run_count === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span className="text-gray-400">No runs yet</span>
              )}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-gray-100">
              <span className="text-sm font-medium" style={{ color: '#2e9e7a' }}>
                View agent →
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(agent.id) }}
                className="text-gray-300 hover:text-red-500 transition-colors p-1"
                title="Delete agent"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  )
}
