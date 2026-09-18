import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type MCPServer, type RegisterServerRequest } from '../api/client'
import CatalogBrowser from '../components/CatalogBrowser'
import ServerCard from '../components/ServerCard'
import { useAuth } from '../contexts/AuthContext'

interface RegisterForm {
  name: string
  description: string
  transport: 'http' | 'stdio' | 'sse'
  endpoint: string
  auth_type: 'none' | 'api_key' | 'oauth'
  token: string
  visible: 'workspace' | 'everyone'
}

const defaultForm: RegisterForm = {
  name: '',
  description: '',
  transport: 'http',
  endpoint: '',
  auth_type: 'api_key',
  token: '',
  visible: 'workspace',
}

export default function MCPRegistry() {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.is_admin)

  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [registerMode, setRegisterMode] = useState<'catalog' | 'custom'>('catalog')
  const [form, setForm] = useState<RegisterForm>(defaultForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  //const [importJson, setImportJson] = useState('')
  //const [importError, setImportError] = useState('')
  //const [importing, setImporting] = useState(false)

  function loadServers() {
    setLoading(true)
    api.getMcpServers().then(setServers).finally(() => setLoading(false))
  }

  useEffect(() => { loadServers() }, [])

  async function handleDelete(id: string) {
    try {
      await api.deleteServer(id)
      setServers((prev) => prev.filter((s) => s.id !== id))
    } catch {
      setToast('Failed to delete server.')
      setTimeout(() => setToast(''), 3000)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const body: RegisterServerRequest = {
        name: form.name.trim(),
        description: form.description.trim() || `${form.name} MCP server`,
        transport: form.transport,
        endpoint: form.endpoint.trim(),
        auth_type: form.auth_type,
        is_shared: form.visible === 'everyone',
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      }
      await api.registerServer(body)
      setToast(`"${form.name}" registered into workspace! Users can now connect their personal PAT.`)
      setPanelOpen(false)
      setForm(defaultForm)
      loadServers()
      setTimeout(() => setToast(''), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed'
      setFormError(msg.includes('409') ? `A server named "${form.name}" is already registered.` : msg)
    } finally {
      setSubmitting(false)
    }
  }

 /*  async function handleImport() {
    setImportError('')
    let parsed: { server: { name: string; endpoint: string; transport: string }; tools: { name: string; description: string; input_schema: Record<string, unknown> }[] }
    try {
      parsed = JSON.parse(importJson)
      if (!parsed.server?.name || !parsed.server?.endpoint || !Array.isArray(parsed.tools)) {
        throw new Error('JSON must have server.name, server.endpoint, and tools[]')
      }
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    setImporting(true)
    try {
      await api.importDiscovery(parsed)
      setToast(`"${parsed.server.name}" imported with ${parsed.tools.length} tools.`)
      setImportJson('')
      setPanelOpen(false)
      loadServers()
      setTimeout(() => setToast(''), 4000)
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  } */

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 p-8 overflow-auto">
        {/* Toast */}
        {toast && (
          <div className="mb-4 p-3 rounded bg-[#e6f7f2] border border-[#2e9e7a] text-[#1f7a5c] text-sm">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">MCP Registry</h1>
            <p className="text-sm text-gray-500 mt-1">
              Tool servers your agents can use. Register one, connect once, reuse everywhere.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setPanelOpen(true)}
              className="px-4 py-2 text-sm text-white rounded-md font-medium"
              style={{ backgroundColor: '#2e9e7a' }}
            >
              + Register a server
            </button>
          )}
        </div>

        {/* User Guide: How to proceed with the site */}
        {!isAdmin && (
          <div className="mb-6 p-4 bg-gradient-to-r from-emerald-50/90 to-teal-50/70 border border-emerald-200/80 rounded-xl shadow-xs">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#2e9e7a]/15 text-[#2e9e7a] flex items-center justify-center shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-emerald-950">
                  Welcome to AgentFactory! Here's how to proceed:
                </h2>
                <p className="text-xs text-emerald-800/90 mt-0.5">
                  Your administrator has registered tool servers for your workspace. Follow these 3 easy steps to build and run your agents:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <div className="bg-white/90 border border-emerald-100/80 rounded-lg p-3 shadow-xs">
                    <div className="flex items-center gap-2 font-semibold text-xs text-emerald-950 mb-1">
                      <span className="w-5 h-5 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-[11px] font-bold">
                        1
                      </span>
                      Connect Your Token (PAT)
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      On any server below (e.g. GitHub, Slack), click <strong className="text-[#2e9e7a] font-medium">+ Connect PAT</strong>. Follow the provider link to generate your personal token, paste it, and save.
                    </p>
                  </div>

                  <div className="bg-white/90 border border-emerald-100/80 rounded-lg p-3 shadow-xs">
                    <div className="flex items-center gap-2 font-semibold text-xs text-emerald-950 mb-1">
                      <span className="w-5 h-5 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-[11px] font-bold">
                        2
                      </span>
                      Build an AI Agent
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      Click <Link to="/build" className="text-[#2e9e7a] font-semibold underline hover:text-emerald-800">+ Build</Link> in the left sidebar. Type what you want the agent to do in plain English — tools are attached automatically!
                    </p>
                  </div>

                  <div className="bg-white/90 border border-emerald-100/80 rounded-lg p-3 shadow-xs">
                    <div className="flex items-center gap-2 font-semibold text-xs text-emerald-950 mb-1">
                      <span className="w-5 h-5 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-[11px] font-bold">
                        3
                      </span>
                      Test & Run
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      Chat with your agent in the interactive playground, see its tool execution in real-time, or trigger it through its dedicated API key.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Servers grid */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Shared Servers
        </p>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : servers.length === 0 ? (
          <div className="border border-gray-200 rounded-xl p-8 bg-white max-w-3xl shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">⚡</span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Welcome to MCP Registry!</h2>
                <p className="text-xs text-gray-500">
                  {isAdmin
                    ? 'Register tool servers so your workspace members can connect and use them.'
                    : 'Connect your personal tokens to use the tool servers registered by your admin.'}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-6">
              MCP servers give your AI agents super-powers — GitHub, Slack, web search, databases, and more.
              {isAdmin
                ? ' As an admin, you register servers into the shared workspace. Users then connect their own Personal Access Tokens (PAT) to activate them.'
                : ' Your admin registers the servers. You just need to connect your own Personal Access Token (PAT) for the servers you want to use.'}
            </p>

            {isAdmin ? (
              /* ── Admin Steps ── */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">1</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Register a Server</h3>
                  <p className="text-xs text-gray-500">
                    Click <strong>"+ Register a server"</strong> above. Pick from the MyMCPRegistry catalog or add a custom endpoint. No tokens required from you.
                  </p>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">2</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Server Goes Live</h3>
                  <p className="text-xs text-gray-500">
                    The server and its tools appear in the shared workspace for all users. Each server starts as <strong>"not connected"</strong> for every user.
                  </p>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">3</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Users Connect PAT</h3>
                  <p className="text-xs text-gray-500">
                    Each user clicks <strong>"+ Connect PAT"</strong> on the server card, pastes their own personal token, and the server becomes active for them.
                  </p>
                </div>
              </div>
            ) : (
              /* ── Regular User Steps ── */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">1</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Find Your Server</h3>
                  <p className="text-xs text-gray-500">
                    Once your admin registers servers, they'll appear here. Look for the server you want to use (e.g. GitHub, Slack, OpenAI).
                  </p>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">2</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Get Your PAT</h3>
                  <p className="text-xs text-gray-500">
                    Click the <strong>"+ Connect PAT"</strong> button on any server card. A direct link to the provider's token page will be shown — click it, generate your token, and copy it.
                  </p>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                  <div className="w-6 h-6 rounded-full bg-[#2e9e7a] text-white flex items-center justify-center text-xs font-bold mb-2">3</div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Paste & Connect</h3>
                  <p className="text-xs text-gray-500">
                    Paste your token into the input field and click <strong>"Save & Connect"</strong>. The server badge turns to <strong className="text-[#2e9e7a]">● connected</strong> and your agents can now use its tools!
                  </p>
                </div>
              </div>
            )}

            {!isAdmin && (
              <div className="mb-4 p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-800">
                <p className="font-semibold mb-1">💡 What is a Personal Access Token (PAT)?</p>
                <p className="text-blue-700 leading-relaxed">
                  A PAT is a secure key you generate from a service's website (like GitHub, Slack, or OpenAI).
                  It lets AgentFactory access that service <strong>on your behalf</strong>. Each user connects their own token —
                  your credentials are never shared with other workspace members. You can disconnect anytime.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                {isAdmin
                  ? 'No tool servers registered yet in your workspace'
                  : 'No tool servers have been registered yet — ask your admin to register servers'}
              </span>
              {isAdmin ? (
                <button
                  onClick={() => setPanelOpen(true)}
                  className="px-4 py-2 text-sm text-white rounded-md font-medium"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  + Register your first server
                </button>
              ) : (
                <Link
                  to="/build"
                  className="px-4 py-2 text-sm text-white rounded-md font-medium inline-block"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  Go to Agent Builder →
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className={`grid gap-4 ${panelOpen ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
            {servers.map((s) => (
              <ServerCard
                key={s.id}
                server={s}
                onDelete={isAdmin ? handleDelete : undefined}
                onUpdate={(updated) => setServers((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Register panel (Admin only) */}
      {isAdmin && panelOpen && (
        <div className="w-[680px] border-l border-gray-200 bg-white p-6 overflow-auto">
          {/* Panel Header with Mode Switcher */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Admin Server Registration
              </p>
              <h2 className="text-lg font-bold text-gray-900 mt-0.5">Register an MCP Server</h2>
            </div>

            <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setRegisterMode('catalog')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  registerMode === 'catalog'
                    ? 'bg-white text-[#2e9e7a] shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ⚡ MyMCPRegistry Catalog
              </button>
              <button
                type="button"
                onClick={() => setRegisterMode('custom')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  registerMode === 'custom'
                    ? 'bg-white text-[#2e9e7a] shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                ⚙️ Custom Endpoint
              </button>
            </div>
          </div>

          {registerMode === 'catalog' ? (
            <CatalogBrowser
              onRegistered={() => {
                loadServers()
                setToast('MCP Server registered into workspace! Users can now connect their personal PAT.')
                setTimeout(() => setToast(''), 4000)
              }}
              onClose={() => setPanelOpen(false)}
            />
          ) : (
            <div className="flex gap-6">
              {/* Custom Form */}
              <form onSubmit={handleSubmit} className="flex-1 space-y-4">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Register custom MCP server</h3>
                  <p className="text-xs text-gray-400">Specify an HTTP or SSE endpoint URL.</p>
                </div>

                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="github"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Issues, pull requests, commits and repository trees."
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transport</label>
                  <select
                    value={form.transport}
                    onChange={(e) => setForm({ ...form, transport: e.target.value as RegisterForm['transport'] })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  >
                    <option value="http">http</option>
                    <option value="stdio">stdio</option>
                    <option value="sse">sse</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint</label>
                  <input
                    required
                    value={form.endpoint}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                    placeholder="https://mcp.example.com/slack"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Authentication</label>
                  <select
                    value={form.auth_type}
                    onChange={(e) => setForm({ ...form, auth_type: e.target.value as RegisterForm['auth_type'] })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  >
                    <option value="api_key">api_key</option>
                    <option value="none">none</option>
                    <option value="oauth">oauth</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Token <span className="text-xs text-gray-400 font-normal">(optional — users connect their own PAT)</span>
                  </label>
                  <input
                    type="password"
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    placeholder="Leave empty or enter optional token…"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Servers register with "not connected" status. Each workspace user connects their own PAT directly on the server card.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Visible to</label>
                  <select
                    value={form.visible}
                    onChange={(e) => setForm({ ...form, visible: e.target.value as RegisterForm['visible'] })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                  >
                    <option value="everyone">Everyone (Shared Workspace)</option>
                    <option value="workspace">Just my workspace</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-60 flex items-center gap-2"
                    style={{ backgroundColor: '#2e9e7a' }}
                  >
                    {submitting && (
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    {submitting ? 'Connecting…' : 'Connect & save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPanelOpen(false); setFormError('') }}
                    className="px-4 py-2 text-sm text-gray-600 rounded-md border border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>

              {/* Tips */}
              <div className="w-56 border border-gray-200 rounded-lg p-4 text-xs text-gray-600 h-fit bg-gray-50/50 space-y-3">
                <p className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
                  <span>💡</span> Setup Tips
                </p>
                <div>
                  <p className="font-medium text-gray-700">Custom MCP Server</p>
                  <p className="text-gray-500 mt-0.5">
                    Connect any remote or local MCP endpoint speaking JSON-RPC over HTTP or SSE.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Prefer Pre-built?</p>
                  <p className="text-gray-500 mt-0.5">
                    Switch to <strong>⚡ MyMCPRegistry Catalog</strong> tab above to choose from 15 verified pre-configured servers.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
