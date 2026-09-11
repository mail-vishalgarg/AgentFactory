import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Agent, type MCPServer } from '../api/client'

// Stage flow: 0=idle → 1=suggest tools → 2=enter credentials → 3=building → 4=done
type Stage = 0 | 1 | 2 | 3 | 4

const STEPS = [
  { label: 'Understand', sub: 'Work out what it should do' },
  { label: 'Pick tools', sub: 'Search the registry, ask the user' },
  { label: 'Check connections', sub: 'Enter credentials for each server' },
  { label: 'Build and deploy', sub: 'Write the config, create the agent' },
]

const CRED_LABELS: Record<string, { label: string; placeholder: string; hint: string; hintUrl: string }> = {
  github: {
    label: 'GitHub Personal Access Token',
    placeholder: 'ghp_...',
    hint: 'Create one at github.com/settings/tokens',
    hintUrl: 'https://github.com/settings/tokens?type=beta',
  },
  slack: {
    label: 'Slack OAuth Token',
    placeholder: 'xoxb-...',
    hint: 'Get your token at api.slack.com/apps',
    hintUrl: 'https://api.slack.com/apps',
  },
}

function deriveNameDesc(prompt: string): { name: string; description: string } {
  const sentences = prompt.split(/[.!?]/).map((s) => s.trim()).filter(Boolean)
  const name = sentences[0]?.slice(0, 60) ?? 'My Agent'
  const description = sentences.slice(1).join('. ') || prompt
  return { name, description }
}

export default function AgentBuilder() {
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>(0)
  const [prompt, setPrompt] = useState('')
  const [suggestedServers, setSuggestedServers] = useState<MCPServer[]>([])
  const [checkedServers, setCheckedServers] = useState<Set<string>>(new Set())
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [preConnected, setPreConnected] = useState<Set<string>>(new Set())
  const [verifyStatus, setVerifyStatus] = useState<Record<string, 'idle' | 'checking' | 'ok' | 'error'>>({})
  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({})
  const [builtAgent, setBuiltAgent] = useState<Agent | null>(null)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stage])

  async function handleSend() {
    if (!prompt.trim()) return
    setStage(1)
    setError('')
    try {
      const servers = await api.suggestTools(prompt)
      setSuggestedServers(servers)
      setCheckedServers(new Set(servers.map((s) => s.id)))
    } catch {
      setError('Failed to load suggested tools.')
    }
  }

  async function handleUseTools() {
    const selected = suggestedServers.filter((s) => checkedServers.has(s.id))
    const needsCreds = selected.filter((s) => s.auth_type !== 'none')
    if (needsCreds.length === 0) {
      setStage(3)
      return
    }

    // Check which servers already have tokens stored elsewhere
    try {
      const serverNames = needsCreds.map((s) => s.name)
      const availability = await api.getCredentialAvailability(serverNames)
      const alreadyConnected = new Set(
        serverNames.filter((name) => availability[name]?.available)
      )
      setPreConnected(alreadyConnected)

      // If ALL servers already have tokens, skip straight to build
      if (alreadyConnected.size === needsCreds.length) {
        setStage(3)
      } else {
        setStage(2)
      }
    } catch {
      // If availability check fails, fall through to credential step
      setStage(2)
    }
  }

  async function handleVerifyAndBuild() {
    const selected = suggestedServers.filter((s) => checkedServers.has(s.id))
    // Only verify servers that aren't already pre-connected
    const needsCreds = selected.filter((s) => s.auth_type !== 'none' && !preConnected.has(s.name))

    const statuses: Record<string, 'idle' | 'checking' | 'ok' | 'error'> = {}
    const msgs: Record<string, string> = {}

    for (const server of needsCreds) {
      const token = credentials[server.name] ?? ''
      if (!token.trim()) {
        statuses[server.name] = 'error'
        msgs[server.name] = 'Token is required'
        continue
      }
      statuses[server.name] = 'checking'
      setVerifyStatus({ ...statuses })

      try {
        const result = await api.verifyToken(server.name, token)
        statuses[server.name] = result.ok ? 'ok' : 'error'
        msgs[server.name] = result.message
      } catch {
        statuses[server.name] = 'error'
        msgs[server.name] = 'Verification failed'
      }
      setVerifyStatus({ ...statuses })
      setVerifyMsg({ ...msgs })
    }

    const allOk = needsCreds.every((s) => statuses[s.name] === 'ok')
    if (!allOk) return

    setStage(3)
  }

  // trigger build when stage reaches 3
  useEffect(() => {
    if (stage !== 3) return
    const selected = suggestedServers.filter((s) => checkedServers.has(s.id))
    const toolIds = selected.flatMap((s) => s.tools.map((t) => t.id))
    const { name, description } = deriveNameDesc(prompt)

    api
      .createAgent({
        name,
        description,
        system_prompt: `You are a helpful assistant that ${description}`,
        model_id: 'gpt-4o-mini',
        temperature: 0.0,
        tool_ids: toolIds,
        user_prompt: prompt,
        credentials,
      })
      .then((agent) => {
        setBuiltAgent(agent)
        setStage(4)
      })
      .catch(() => setError('Failed to build agent.'))
  }, [stage])

  const completedSteps = stage === 0 ? 0 : stage === 1 ? 1 : stage === 2 ? 2 : stage === 3 ? 3 : 4
  const selectedServers = suggestedServers.filter((s) => checkedServers.has(s.id))
  const serversNeedingCreds = selectedServers.filter((s) => s.auth_type !== 'none')
  const serversNeedingNewToken = serversNeedingCreds.filter((s) => !preConnected.has(s.name))

  return (
    <div className="flex h-full">
      {/* Left — chat */}
      <div className="flex-1 flex flex-col p-8 overflow-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Build an agent</h1>
          <p className="text-sm text-gray-500">
            Describe what you want. Switch to a form if you would rather fill fields in.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
            {error}
          </div>
        )}

        {/* Stage 0 — idle prompt input */}
        {stage === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-full max-w-xl">
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Describe what you want your agent to do…"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">Press Enter or click Send.</span>
                <button
                  onClick={handleSend}
                  className="px-4 py-2 text-sm text-white rounded-md font-medium"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stage 1+ — chat messages */}
        {stage >= 1 && (
          <div className="flex flex-col gap-4 max-w-2xl">
            {/* User bubble */}
            <div className="flex justify-end">
              <div className="bg-gray-100 text-gray-800 text-sm px-4 py-2 rounded-2xl rounded-tr-sm max-w-md">
                {prompt}
              </div>
            </div>

            {/* System understanding */}
            <div className="flex gap-3 items-start">
              <ForgeAvatar />
              <div className="text-sm text-gray-700 space-y-2">
                <p>Got it. Here's what I think you're after:</p>
                <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                  <p className="font-semibold text-gray-900">{deriveNameDesc(prompt).name}</p>
                  <p className="text-gray-500 text-xs mt-1">{deriveNameDesc(prompt).description}</p>
                </div>
                <p>I searched your registry. These servers cover it — which should it use?</p>
              </div>
            </div>

            {/* Stage 1 — tool selection */}
            {stage === 1 && (
              <div className="border rounded-lg overflow-hidden" style={{ borderColor: '#2e9e7a' }}>
                <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold" style={{ backgroundColor: '#e6f7f2', color: '#1f7a5c' }}>
                  <span>PAUSED · WAITING FOR YOU</span>
                  <span>INTERRUPT: SELECT_TOOLS</span>
                </div>
                <div className="p-4 space-y-3">
                  {suggestedServers.map((server) => (
                    <label key={server.id} className="flex items-start gap-3 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[#2e9e7a]"
                        checked={checkedServers.has(server.id)}
                        onChange={(e) => {
                          const next = new Set(checkedServers)
                          e.target.checked ? next.add(server.id) : next.delete(server.id)
                          setCheckedServers(next)
                        }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{server.name}</span>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#2e9e7a' }} />
                          <span className="text-xs text-gray-500">{server.auth_type !== 'none' ? 'needs credentials' : 'no auth required'}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {server.tools.map((t) => `${t.name} — ${t.permission_level}`).join(' · ')}
                        </p>
                      </div>
                    </label>
                  ))}
                  <button
                    onClick={handleUseTools}
                    disabled={checkedServers.size === 0}
                    className="px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-40"
                    style={{ backgroundColor: '#2e9e7a' }}
                  >
                    Use these {checkedServers.size}
                  </button>
                </div>
              </div>
            )}

            {/* Stage 2 — credentials form */}
            {stage >= 2 && (
              <>
                <div className="flex justify-end">
                  <div className="bg-gray-100 text-gray-800 text-sm px-4 py-2 rounded-2xl rounded-tr-sm">
                    Those are right.
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <ForgeAvatar />
                  <div className="text-sm text-gray-700 w-full space-y-2">
                    <p>Checked your connections.{serversNeedingNewToken.length > 0 ? ' I need credentials for these servers:' : ' All servers are already connected.'}</p>

                    {stage === 2 && (
                      <div className="border rounded-lg overflow-hidden" style={{ borderColor: '#2e9e7a' }}>
                        <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold" style={{ backgroundColor: '#e6f7f2', color: '#1f7a5c' }}>
                          <span>PAUSED · CHECK CONNECTIONS</span>
                          <span>INTERRUPT: MISSING_CONNECTION</span>
                        </div>
                        <div className="p-4 space-y-4">
                          {/* Already-connected servers */}
                          {serversNeedingCreds.filter((s) => preConnected.has(s.name)).map((server) => (
                            <div key={server.id} className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                              <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">✓</span>
                              <div>
                                <span className="font-semibold text-sm text-gray-800">{server.name}</span>
                                <span className="text-xs text-green-600 ml-2">already connected — token reused</span>
                              </div>
                            </div>
                          ))}

                          {/* Servers needing new tokens */}
                          {serversNeedingNewToken.map((server) => {
                            const meta = CRED_LABELS[server.name]
                            const status = verifyStatus[server.name]
                            return (
                              <div key={server.id} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-gray-800">{server.name}</span>
                                  <span className="text-xs text-gray-400">· {server.auth_type}</span>
                                  {status === 'ok' && <span className="text-xs text-green-600 font-medium">✓ {verifyMsg[server.name]}</span>}
                                  {status === 'error' && <span className="text-xs text-red-500">{verifyMsg[server.name]}</span>}
                                  {status === 'checking' && <span className="text-xs text-gray-400 animate-pulse">Checking…</span>}
                                </div>
                                <label className="block text-xs text-gray-500 mb-1">
                                  {meta?.label ?? `${server.name} API Token`}
                                </label>
                                <input
                                  type="password"
                                  value={credentials[server.name] ?? ''}
                                  onChange={(e) => setCredentials({ ...credentials, [server.name]: e.target.value })}
                                  placeholder={meta?.placeholder ?? 'Enter token…'}
                                  className={`w-full border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2e9e7a] ${
                                    status === 'error' ? 'border-red-400 bg-red-50' :
                                    status === 'ok' ? 'border-green-400 bg-green-50' : 'border-gray-300'
                                  }`}
                                />
                                {meta?.hint && (
                                  <a href={meta.hintUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2e9e7a] hover:underline">
                                    {meta.hint} ↗
                                  </a>
                                )}
                              </div>
                            )
                          })}

                          <button
                            onClick={handleVerifyAndBuild}
                            className="mt-2 px-4 py-2 text-sm text-white rounded-md font-medium w-full"
                            style={{ backgroundColor: '#2e9e7a' }}
                          >
                            {serversNeedingNewToken.length === 0 ? 'Build' : 'Connect & Build'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* After credentials confirmed */}
                    {stage > 2 && (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {serversNeedingCreds.map((s) => (
                          <span key={s.id} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-gray-700 font-medium">{s.name}</span>
                            <span className="text-xs text-green-600">{preConnected.has(s.name) ? 'reused' : 'connected'}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Stage 3 — building */}
            {stage === 3 && (
              <div className="flex gap-3 items-center">
                <ForgeAvatar />
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <svg className="animate-spin h-4 w-4" style={{ color: '#2e9e7a' }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Building and deploying…
                </div>
              </div>
            )}

            {/* Stage 4 — result */}
            {stage === 4 && builtAgent && (
              <div className="flex gap-3 items-start">
                <ForgeAvatar />
                <div className="text-sm text-gray-700 w-full space-y-3">
                  <p>Built and deployed. Here it is:</p>
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-900">{builtAgent.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#e6f7f2', color: '#2e9e7a' }}>• live</span>
                    </div>
                    <p className="text-xs text-gray-500">{builtAgent.description}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>
                        <span className="text-gray-400">Shape</span>
                        <span className="ml-2 font-medium">ReAct agent</span>
                        <span className="ml-1 px-1.5 py-0.5 rounded text-white text-xs" style={{ backgroundColor: '#2e9e7a' }}>single-agent</span>
                      </div>
                      <div>
                        <span className="text-gray-400">Score</span>
                        <span className="ml-2 text-gray-400 italic">not tested yet</span>
                        <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-100 text-orange-600 font-bold text-xs">C</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block mb-1">Tools</span>
                      <div className="flex flex-wrap gap-1">
                        {builtAgent.config.tools.map((t) => (
                          <span key={`${t.mcp_server_name}.${t.tool_name}`} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                            {t.mcp_server_name}.{t.tool_name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={() => navigate(`/agents/${builtAgent.id}?tab=playground`)}
                        className="px-4 py-2 text-sm text-white rounded-md font-medium"
                        style={{ backgroundColor: '#2e9e7a' }}
                      >
                        Open the playground
                      </button>
                      <button
                        onClick={() => navigate('/agents')}
                        className="px-4 py-2 text-sm text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50 font-medium"
                      >
                        Go to My Agents
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Right — Builder Graph */}
      <div className="w-72 border-l border-gray-200 bg-white p-6 flex flex-col gap-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Builder Graph</p>
        {STEPS.map((step, i) => {
          const done = i < completedSteps
          const active = i === completedSteps
          return (
            <div key={step.label} className="flex gap-3 items-start pb-6 relative">
              {i < STEPS.length - 1 && (
                <div className="absolute left-3.5 top-7 w-px h-full bg-gray-200" />
              )}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 z-10"
                style={{
                  backgroundColor: done ? '#2e9e7a' : active ? '#e6f7f2' : '#f3f4f6',
                  color: done ? 'white' : active ? '#2e9e7a' : '#9ca3af',
                  border: active ? '2px solid #2e9e7a' : 'none',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <div>
                <p className={`text-sm font-medium ${done || active ? 'text-gray-900' : 'text-gray-400'}`}>
                  {step.label}
                </p>
                <p className="text-xs text-gray-400">{step.sub}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ForgeAvatar() {
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
      style={{ backgroundColor: '#2e9e7a' }}
    >
      AF
    </div>
  )
}
