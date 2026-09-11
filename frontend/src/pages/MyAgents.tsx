import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Agent } from '../api/client'

const statusStyle: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  live: 'bg-[#e6f7f2] text-[#2e9e7a]',
  archived: 'bg-yellow-100 text-yellow-700',
}

export default function MyAgents() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    api.listAgents().then(setAgents).finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return
    await api.deleteAgent(id)
    load()
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
    </div>
  )
}
