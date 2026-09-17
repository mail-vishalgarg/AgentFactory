import { useState } from 'react'
import { api, type MCPServer } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { getPatInfo } from '../utils/patLinks'
import ToolPermissionBadge from './ToolPermissionBadge'

const statusColor: Record<string, string> = {
  healthy: '#2e9e7a',
  degraded: '#f59e0b',
  dead: '#ef4444',
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never checked'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  return `${Math.floor(diff / 60)}h ago`
}

interface Props {
  server: MCPServer
  onDelete?: (id: string) => void
  onUpdate?: (updated: MCPServer) => void
}

export default function ServerCard({ server, onDelete, onUpdate }: Props) {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.is_admin)

  // Token / Connection state
  const [showConnectForm, setShowConnectForm] = useState(false)
  const [patToken, setPatToken] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [connectSuccess, setConnectSuccess] = useState(false)
  const [connectMessage, setConnectMessage] = useState('')

  // Sync tools state (Admin only)
  const [syncing, setSyncing] = useState(false)
  const [syncToken, setSyncToken] = useState('')
  const [syncEndpoint, setSyncEndpoint] = useState(server.endpoint)
  const [showSyncInput, setShowSyncInput] = useState(false)
  const [syncError, setSyncError] = useState('')

  // Tools dropdown state
  const [showToolsDropdown, setShowToolsDropdown] = useState(false)
  const patInfo = getPatInfo(server.name, server.endpoint)

  async function handleConnectToken(e: React.FormEvent) {
    e.preventDefault()
    if (!patToken.trim()) return

    setConnecting(true)
    setConnectError('')
    try {
      const res = await api.addConnection(server.name, patToken.trim())
      setConnectSuccess(true)
      setConnectMessage(res.message || 'Token verified and connected successfully!')
      setTimeout(() => {
        setConnectSuccess(false)
        setConnectMessage('')
        setShowConnectForm(false)
        setPatToken('')
      }, 2000)
      onUpdate?.({ ...server, connected: true })
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : 'Token verification failed.')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm(`Disconnect your personal token from "${server.name}"?`)) return
    try {
      await api.revokeConnection(server.name)
      onUpdate?.({ ...server, connected: false })
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect token.')
    }
  }

  async function handleSync() {
    if (!syncToken.trim()) return
    setSyncing(true)
    setSyncError('')
    try {
      const endpointOverride = syncEndpoint.trim() !== server.endpoint ? syncEndpoint.trim() : undefined
      const updated = await api.syncServerTools(server.id, syncToken.trim(), endpointOverride)
      setSyncToken('')
      setShowSyncInput(false)
      onUpdate?.(updated)
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 transition-shadow hover:shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{server.name}</span>
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ backgroundColor: statusColor[server.status] ?? '#6b7280' }}
          />
          <span className="text-xs text-gray-500">{server.status}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status Badge & Actions (Users only) */}
          {!isAdmin && (
            server.connected ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs px-2.5 py-0.5 rounded font-medium border flex items-center gap-1 bg-[#e6f7f2]"
                  style={{ borderColor: '#2e9e7a', color: '#2e9e7a' }}
                >
                  <span>●</span> connected
                </span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  title="Disconnect your personal token"
                  className="text-xs text-gray-400 hover:text-red-500 hover:underline px-1 cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded font-medium border border-gray-200 text-gray-500 bg-gray-50 flex items-center gap-1">
                  <span>○</span> not connected
                </span>
                {server.auth_type !== 'none' && !showConnectForm && (
                  <button
                    type="button"
                    onClick={() => setShowConnectForm(true)}
                    className="text-xs font-semibold px-2.5 py-0.5 rounded text-white shadow-sm hover:opacity-90 cursor-pointer"
                    style={{ backgroundColor: '#2e9e7a' }}
                  >
                    + Connect PAT
                  </button>
                )}
              </div>
            )
          )}

          {/* Admin Delete */}
          {isAdmin && onDelete && (
            <button
              onClick={() => {
                if (confirm(`Remove "${server.name}" from the workspace registry?`)) {
                  onDelete(server.id)
                }
              }}
              title="Delete server from workspace"
              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-500">{server.description}</p>

      {/* Tags */}
      <div className="flex gap-2 flex-wrap items-center">
        {[server.transport, server.auth_type, `${server.tools.length} tools`].map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
        {!isAdmin && server.auth_type !== 'none' && (
          <a
            href={patInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5 ml-auto font-medium"
            title={`Get token from ${patInfo.serviceName}`}
          >
            <span>{patInfo.serviceName} PAT Site</span>
            <span>↗</span>
          </a>
        )}
      </div>

      {/* Inline Connect PAT Panel for Users (not Admin) */}
      {!isAdmin && showConnectForm && (
        <form onSubmit={handleConnectToken} className="mt-1 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
              <span>🔑</span> Connect Your Personal Access Token (PAT)
            </span>
            <button
              type="button"
              onClick={() => { setShowConnectForm(false); setConnectError('') }}
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              ✕
            </button>
          </div>

          {/* Website Redirect Guidance Card */}
          <div className="bg-blue-50/80 border border-blue-200 rounded-md p-2.5 space-y-1.5 text-xs text-blue-950">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-blue-900">
                  Need a token for {patInfo.serviceName}?
                </p>
                <p className="text-[11px] text-blue-700 mt-0.5 leading-snug">
                  {patInfo.instructions}
                </p>
                {patInfo.scopes && (
                  <p className="text-[10px] text-blue-600 font-mono mt-1">
                    Scopes: {patInfo.scopes}
                  </p>
                )}
              </div>
              <a
                href={patInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded bg-white text-blue-700 border border-blue-300 hover:bg-blue-100 shadow-sm transition-colors shrink-0"
              >
                <span>Open {patInfo.serviceName}</span>
                <span>↗</span>
              </a>
            </div>
          </div>

          {/* Token Input */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-700">
              Personal Access Token / API Key
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={patToken}
                onChange={(e) => setPatToken(e.target.value)}
                placeholder="Paste token (ghp_…, xoxb-…, Bearer key)…"
                className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2e9e7a] bg-white font-mono pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 hover:text-gray-700 px-1 py-0.5"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {connectError && (
            <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
              {connectError}
            </div>
          )}

          {connectSuccess && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded font-medium flex items-center gap-1.5">
              <span>✓</span> {connectMessage || 'Token verified and connected successfully!'}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={connecting || !patToken.trim()}
              className="px-3 py-1.5 text-xs font-medium text-white rounded disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              style={{ backgroundColor: '#2e9e7a' }}
            >
              {connecting && (
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {connecting ? 'Connecting…' : 'Save & Connect'}
            </button>
            <button
              type="button"
              onClick={() => { setShowConnectForm(false); setConnectError('') }}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Tools Dropdown */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50">
        <button
          type="button"
          onClick={() => setShowToolsDropdown(!showToolsDropdown)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Tools</span>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-200 text-gray-800">
              {server.tools.length}
            </span>
          </div>
          <div className="flex items-center gap-1 text-gray-500 text-[11px]">
            <span>{showToolsDropdown ? 'Hide tools' : 'View all tools'}</span>
            <span className={`transform transition-transform duration-200 ${showToolsDropdown ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>
        </button>

        {showToolsDropdown && (
          <div className="border-t border-gray-200 bg-white divide-y divide-gray-100 max-h-56 overflow-y-auto px-3 py-1">
            {server.tools.length === 0 ? (
              <div className="py-2 text-center text-xs text-gray-400">
                No tools registered yet for this server.
              </div>
            ) : (
              server.tools.map((t) => (
                <div key={t.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-gray-800 truncate" title={t.name}>
                    {t.name}
                  </span>
                  <ToolPermissionBadge level={t.permission_level} />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Sync tools (Admin only) */}
      {isAdmin && server.auth_type !== 'none' && (
        <div className="border-t border-gray-100 pt-2">
          {showSyncInput ? (
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={syncEndpoint}
                onChange={(e) => setSyncEndpoint(e.target.value)}
                placeholder="https://api.githubcopilot.com/mcp/"
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#2e9e7a] font-mono"
              />
              <input
                type="password"
                value={syncToken}
                onChange={(e) => setSyncToken(e.target.value)}
                placeholder="Paste admin token to sync tools from endpoint…"
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#2e9e7a]"
              />
              {syncError && <p className="text-xs text-red-500">{syncError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing || !syncToken.trim()}
                  className="text-xs px-2 py-1 rounded text-white disabled:opacity-50 cursor-pointer"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
                <button
                  onClick={() => { setShowSyncInput(false); setSyncToken(''); setSyncError(''); setSyncEndpoint(server.endpoint) }}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowSyncInput(true)}
              className="text-xs text-[#2e9e7a] hover:underline cursor-pointer"
            >
              ↻ Sync tools from server
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-gray-400">checked {timeAgo(server.last_checked_at)}</p>
    </div>
  )
}
