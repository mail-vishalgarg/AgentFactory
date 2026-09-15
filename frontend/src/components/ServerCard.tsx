import { useState } from 'react'
import { api, type MCPServer } from '../api/client'
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
  const [syncing, setSyncing] = useState(false)
  const [syncToken, setSyncToken] = useState('')
  const [syncEndpoint, setSyncEndpoint] = useState(server.endpoint)
  const [showSyncInput, setShowSyncInput] = useState(false)
  const [syncError, setSyncError] = useState('')

  const visibleTools = server.tools.slice(0, 6)
  const extra = server.tools.length - 6

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
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
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
          {server.connected ? (
            <span
              className="text-xs px-3 py-1 rounded border font-medium"
              style={{ borderColor: '#2e9e7a', color: '#2e9e7a' }}
            >
              connected
            </span>
          ) : (
            <span className="text-xs px-3 py-1 rounded border font-medium border-gray-300 text-gray-400">
              not connected
            </span>
          )}
          {onDelete && (
            <button
              onClick={() => {
                if (confirm(`Remove "${server.name}" from the registry?`)) {
                  onDelete(server.id)
                }
              }}
              title="Delete server"
              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
      <div className="flex gap-2 flex-wrap">
        {[server.transport, server.auth_type, `${server.tools.length} tools`].map((tag) => (
          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
      </div>

      {/* Tools */}
      <div className="flex flex-col gap-1">
        {visibleTools.map((t) => (
          <div key={t.id} className="flex items-center justify-between">
            <span className="text-xs font-mono text-gray-700">{t.name}</span>
            <ToolPermissionBadge level={t.permission_level} />
          </div>
        ))}
        {extra > 0 && (
          <span className="text-xs text-gray-400">+ {extra} more</span>
        )}
      </div>

      {/* Sync tools */}
      {server.auth_type !== 'none' && (
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
                placeholder="Paste token…"
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#2e9e7a]"
              />
              {syncError && <p className="text-xs text-red-500">{syncError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing || !syncToken.trim()}
                  className="text-xs px-2 py-1 rounded text-white disabled:opacity-50"
                  style={{ backgroundColor: '#2e9e7a' }}
                >
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
                <button
                  onClick={() => { setShowSyncInput(false); setSyncToken(''); setSyncError(''); setSyncEndpoint(server.endpoint) }}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowSyncInput(true)}
              className="text-xs text-[#2e9e7a] hover:underline"
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
