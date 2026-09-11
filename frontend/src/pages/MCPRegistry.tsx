import { useEffect, useState } from 'react'
import { api, type MCPServer, type RegisterServerRequest } from '../api/client'
import ServerCard from '../components/ServerCard'

interface RegisterForm {
  name: string
  description: string
  transport: 'http' | 'stdio' | 'sse'
  endpoint: string
  auth_type: 'none' | 'api_key' | 'oauth'
  visible: 'workspace' | 'everyone'
}

const defaultForm: RegisterForm = {
  name: '',
  description: '',
  transport: 'http',
  endpoint: '',
  auth_type: 'api_key',
  visible: 'workspace',
}

export default function MCPRegistry() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm] = useState<RegisterForm>(defaultForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')

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
      }
      await api.registerServer(body)
      setToast(`"${form.name}" registered and tools loaded successfully!`)
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
          <button
            onClick={() => setPanelOpen(true)}
            className="px-4 py-2 text-sm text-white rounded-md font-medium"
            style={{ backgroundColor: '#2e9e7a' }}
          >
            + Register a server
          </button>
        </div>

        {/* Info banner */}
        <div className="mb-6 p-4 border-l-4 border-amber-400 bg-amber-50 rounded-r-md text-sm text-gray-700">
          <p className="font-semibold text-amber-800 mb-2 uppercase text-xs tracking-wide">
            What you must build on this screen
          </p>
          <ol className="list-decimal list-inside space-y-1">
            <li>A form to register an MCP server: name, transport, endpoint, auth type.</li>
            <li>
              On save, <strong>your platform connects to the server and asks it what tools it has</strong>.
              Nobody types tool names by hand.
            </li>
            <li>
              Each tool is stored as <strong>read</strong>, <strong>write</strong> or{' '}
              <strong>destructive</strong>. That marking forces an approval step later.
            </li>
            <li>A scheduled job re-checks every server and marks the dead ones.</li>
            <li>Servers can be shared with everyone or private to one company.</li>
          </ol>
        </div>

        {/* Servers grid */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Shared Servers
        </p>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {servers.map((s) => (
              <ServerCard key={s.id} server={s} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Register panel */}
      {panelOpen && (
        <div className="w-[640px] border-l border-gray-200 bg-white p-8 overflow-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Registering a Server
          </p>
          <div className="flex gap-6">
            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 space-y-4">
              <div>
                <h2 className="font-semibold text-gray-900">Register an MCP server</h2>
                <p className="text-xs text-gray-400">Saved only after the platform successfully connects.</p>
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
                  <option value="none">none</option>
                  <option value="api_key">api_key</option>
                  <option value="oauth">oauth</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visible to</label>
                <select
                  value={form.visible}
                  onChange={(e) => setForm({ ...form, visible: e.target.value as RegisterForm['visible'] })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
                >
                  <option value="workspace">Just my workspace</option>
                  <option value="everyone">Everyone</option>
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

            {/* What happens on save */}
            <div className="w-52 border border-gray-200 rounded-lg p-4 text-sm text-gray-600 h-fit">
              <p className="font-semibold text-gray-800 mb-3">What happens on save</p>
              <ol className="space-y-2 text-xs">
                <li><span className="font-medium text-gray-800">1</span>  Open a connection to the endpoint</li>
                <li><span className="font-medium text-gray-800">2</span>  Ask it for its tool list</li>
                <li><span className="font-medium text-gray-800">3</span>  Mark each tool read, write or destructive</li>
                <li><span className="font-medium text-gray-800">4</span>  Store the list; mark the server healthy</li>
                <li className="text-red-500">✕ If it does not answer, nothing is saved</li>
              </ol>
              <p className="text-xs text-gray-400 mt-3">
                A scheduled job re-checks every server and marks the dead ones.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
