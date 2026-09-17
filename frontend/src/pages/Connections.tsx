import { useEffect, useState } from 'react'
import { api, type Connection } from '../api/client'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface AddPanelProps {
  onClose: () => void
  onAdded: (conn: Connection) => void
}

function AddPanel({ onClose, onAdded }: AddPanelProps) {
  const [serverName, setServerName] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setSaving(true)
    try {
      const conn = await api.addConnection(serverName.trim(), token.trim())
      setSuccessMsg(conn.message || 'Token verified and connected successfully!')
      setTimeout(() => {
        onAdded(conn)
      }, 1200)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-[480px] border-l border-gray-200 bg-white p-8 overflow-auto">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Add a Connection
      </p>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">New credential</h2>
          <p className="text-xs text-gray-400">Token is verified before being saved.</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded font-medium flex items-center gap-1.5">
            <span>✓</span> {successMsg}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Server name</label>
          <input
            required
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="github, slack, …"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Token</label>
          <input
            required
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_… or xoxb-…"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-60 flex items-center gap-2"
            style={{ backgroundColor: '#2e9e7a' }}
          >
            {saving && (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {saving ? 'Verifying…' : 'Verify & Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 rounded-md border border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Connections() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [toast, setToast] = useState('')

  function loadConnections() {
    setLoading(true)
    api.listConnections().then(setConnections).finally(() => setLoading(false))
  }

  useEffect(() => { loadConnections() }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleRevoke(serverName: string) {
    if (!confirm(`Revoke the credential for "${serverName}"? This will remove it from all agents.`)) return
    setConnections((prev) => prev.filter((c) => c.server_name !== serverName))
    try {
      await api.revokeConnection(serverName)
      showToast('Connection revoked')
    } catch {
      showToast('Failed to revoke connection')
      loadConnections()
    }
  }

  function handleAdded(conn: Connection) {
    setConnections((prev) => {
      const without = prev.filter((c) => c.server_name !== conn.server_name)
      return [conn, ...without]
    })
    setPanelOpen(false)
    showToast(`"${conn.server_name}" connection saved`)
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-8 overflow-auto">
        {toast && (
          <div className="mb-4 p-3 rounded bg-[#e6f7f2] border border-[#2e9e7a] text-[#1f7a5c] text-sm">
            {toast}
          </div>
        )}

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Connections</h1>
            <p className="text-sm text-gray-500 mt-1">
              Credentials you have given the platform. Added once, reused by every agent you build.
            </p>
          </div>
          <button
            onClick={() => setPanelOpen(true)}
            className="px-4 py-2 text-sm text-white rounded-md font-medium bg-gray-900 hover:bg-gray-800"
          >
            + Add a connection
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 text-sm">No connections yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Server</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Secret</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Added</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Last used</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {connections.map((c) => (
                  <tr key={c.server_name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.server_name}</td>
                    <td className="px-4 py-3">
                      {c.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                          expired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono tracking-widest">••••••••••</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-gray-500">{relativeTime(c.last_used_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRevoke(c.server_name)}
                        className="px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {panelOpen && (
        <AddPanel onClose={() => setPanelOpen(false)} onAdded={handleAdded} />
      )}
    </div>
  )
}
