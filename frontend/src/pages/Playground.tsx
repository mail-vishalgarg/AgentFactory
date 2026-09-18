import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Agent } from '../api/client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface PendingApproval {
  thread_id: string
  tool_name: string
  tool_args: Record<string, unknown>
}

export default function Playground() {
  const { id } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    api.getAgent(id).then(setAgent).catch(() => setFetchError('Agent not found.'))
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, pendingApproval])

  async function send() {
    if (!input.trim() || !id || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)
    try {
      const res = await api.runAgent(id, userMsg)
      if (res.status === 'pending_approval' && res.thread_id) {
        setPendingApproval({
          thread_id: res.thread_id,
          tool_name: res.pending_tool_name ?? 'unknown',
          tool_args: res.pending_tool_args ?? {},
        })
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.output }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Error running agent.' }])
    } finally {
      setLoading(false)
    }
  }

  async function handleApproval(approved: boolean) {
    if (!pendingApproval || !id) return
    const { thread_id, tool_name } = pendingApproval
    setLoading(true)
    setPendingApproval(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: approved ? `✓ Approved: ${tool_name}` : `✗ Rejected: ${tool_name}` },
    ])
    try {
      const res = await api.resumeAgent(id, thread_id, approved)
      if (res.status === 'pending_approval' && res.thread_id) {
        setPendingApproval({
          thread_id: res.thread_id,
          tool_name: res.pending_tool_name ?? 'unknown',
          tool_args: res.pending_tool_args ?? {},
        })
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.output }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Error resuming agent.' }])
    } finally {
      setLoading(false)
    }
  }

  if (fetchError) {
    return <div className="p-8 text-red-500">{fetchError}</div>
  }

  if (!agent) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>
  }

  return (
    <div className="flex h-full">
      {/* Left — config summary */}
      <div className="w-72 border-r border-gray-200 bg-white p-6 overflow-auto flex-shrink-0">
        <Link to="/agents" className="text-xs hover:underline mb-4 block" style={{ color: '#2e9e7a' }}>
          ← Back to My Agents
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold text-gray-900 text-lg">{agent.name}</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#e6f7f2] text-[#2e9e7a]">
            {agent.status}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">{agent.description}</p>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Model</p>
            <p className="text-sm text-gray-700">{agent.config.model.model_id}</p>
            <p className="text-xs text-gray-400">temp {agent.config.model.temperature}</p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tools</p>
            <div className="space-y-1">
              {agent.config.tools.map((t) => (
                <div key={`${t.mcp_server_name}.${t.tool_name}`} className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-700">{t.mcp_server_name}.{t.tool_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    t.permission_level === 'read' ? 'bg-gray-100 text-gray-500' :
                    t.permission_level === 'write' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>{t.permission_level}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">System Prompt</p>
            <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-100 line-clamp-4">
              {agent.config.system_prompt}
            </p>
          </div>
        </div>
      </div>

      {/* Right — chat */}
      <div className="flex-1 flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 bg-white">
          <h1 className="font-semibold text-gray-900">Playground — {agent.name}</h1>
          <p className="text-xs text-gray-400">Test your agent. Responses use placeholder tools until real MCP connections are wired.</p>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {messages.length === 0 && !pendingApproval && (
            <div className="text-center text-gray-300 text-sm mt-12">
              Send a message to test your agent.
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-3`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: '#2e9e7a' }}>F</div>
              )}
              <div
                className={`max-w-lg text-sm px-4 py-2 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-gray-100 text-gray-800 rounded-tr-sm'
                    : 'bg-white border border-gray-200 text-gray-700 rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Approval card */}
          {pendingApproval && (
            <div className="flex justify-start gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: '#2e9e7a' }}>F</div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl rounded-tl-sm p-4 max-w-lg space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-amber-600 font-bold text-base">⚠</span>
                  <p className="text-sm font-semibold text-amber-800">Approval Required</p>
                </div>
                <p className="text-sm text-amber-700">
                  The agent wants to run{' '}
                  <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded text-xs font-mono">
                    {pendingApproval.tool_name}
                  </code>
                </p>
                {Object.keys(pendingApproval.tool_args).length > 0 && (
                  <pre className="text-xs bg-white border border-amber-200 rounded-lg p-3 overflow-auto max-h-32 text-gray-700">
                    {JSON.stringify(pendingApproval.tool_args, null, 2)}
                  </pre>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproval(true)}
                    disabled={loading}
                    className="px-4 py-1.5 text-sm text-white rounded-lg font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleApproval(false)}
                    disabled={loading}
                    className="px-4 py-1.5 text-sm text-white rounded-lg font-medium bg-red-500 hover:bg-red-600 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex gap-3 items-center">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#2e9e7a' }}>F</div>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send() }}
              placeholder={pendingApproval ? 'Approve or reject the pending tool call above…' : `Ask ${agent.name} something…`}
              disabled={!!pendingApproval || loading}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a] disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim() || !!pendingApproval}
              className="px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-40"
              style={{ backgroundColor: '#2e9e7a' }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
