import { useEffect, useState } from 'react'
import { api, type CatalogServer } from '../api/client'
import ToolPermissionBadge from './ToolPermissionBadge'

interface Props {
  onRegistered: () => void
  onClose: () => void
}

export default function CatalogBrowser({ onRegistered, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null)
  const [registeringServer, setRegisteringServer] = useState<string | null>(null)
  const [registerError, setRegisterError] = useState<string | null>(null)

  function loadCatalog() {
    setLoading(true)
    setError('')
    api
      .getCatalog()
      .then(setCatalog)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load MyMCPRegistry catalog.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadCatalog()
  }, [])

  const categories = ['All', ...Array.from(new Set(catalog.map((s) => s.category).filter(Boolean)))]

  const filtered = catalog.filter((s) => {
    const matchesCategory = category === 'All' || s.category === category
    const q = search.toLowerCase().trim()
    const matchesSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.display_name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tools.some((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    return matchesCategory && matchesSearch
  })

  async function handleDirectRegister(server: CatalogServer) {
    setRegisteringServer(server.name)
    setRegisterError(null)
    try {
      // Direct registration without token: registers server & all tools into workspace
      await api.registerFromCatalog(server.name, '', true)
      await loadCatalog()
      onRegistered()
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : `Failed to register ${server.display_name}.`)
    } finally {
      setRegisteringServer(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Notice for Admin */}
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
        <p className="font-semibold flex items-center gap-1.5">
          <span>⚡</span> Direct MCP Server Registration
        </p>
        <p className="mt-0.5 text-emerald-700">
          As an admin, you can register any server directly into the shared workspace. No tokens are needed during registration. Workspace users will connect their own Personal Access Tokens (PAT) individually.
        </p>
      </div>

      {/* Search & Category Filter */}
      <div className="space-y-2.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by server name, description, or tool (e.g. 'pull_request', 'slack')…"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
        />

        <div className="flex gap-1.5 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                category === c
                  ? 'bg-[#2e9e7a] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {registerError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
          {registerError}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Loading catalog from MyMCPRegistry…
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          <p className="font-semibold mb-1">Could not connect to MyMCPRegistry</p>
          <p className="text-xs">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          No matching servers found for "{search}".
        </div>
      ) : (
        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
          {filtered.map((s) => {
            const isExpanded = expandedServerId === s.id
            const isThisRegistering = registeringServer === s.name

            return (
              <div
                key={s.id}
                className="border border-gray-200 rounded-lg p-3.5 bg-white hover:border-gray-300 transition-shadow space-y-2.5"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{s.display_name}</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        {s.category}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">({s.name})</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{s.description}</p>
                  </div>

                  {/* Register action */}
                  {s.is_registered ? (
                    <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-md bg-[#e6f7f2] text-[#2e9e7a] border border-[#2e9e7a] flex items-center gap-1">
                      <span>✓</span> In Workspace
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleDirectRegister(s)}
                      disabled={Boolean(registeringServer)}
                      className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md text-white shadow-sm hover:opacity-95 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                      style={{ backgroundColor: '#2e9e7a' }}
                    >
                      {isThisRegistering ? (
                        <>
                          <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span>Registering…</span>
                        </>
                      ) : (
                        <span>+ Register Server</span>
                      )}
                    </button>
                  )}
                </div>


                {/* Tools expandable preview */}
                <div className="pt-1 border-t border-gray-100 flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    <strong>{s.tools_count}</strong> tools available
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedServerId(isExpanded ? null : s.id)}
                    className="text-[#2e9e7a] hover:underline font-medium cursor-pointer"
                  >
                    {isExpanded ? '▲ Hide Tools' : `▼ View All ${s.tools_count} Tools`}
                  </button>
                </div>

                {/* Expanded Tools List */}
                {isExpanded && (
                  <div className="mt-1 pt-1.5 border-t border-gray-100 space-y-1.5 max-h-48 overflow-y-auto bg-gray-50/70 p-2 rounded text-xs">
                    {s.tools.map((t) => (
                      <div
                        key={t.name}
                        className="flex items-start justify-between gap-2 py-1 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="truncate">
                          <span className="font-mono font-medium text-gray-800">{t.name}</span>
                          {t.description && (
                            <p className="text-[11px] text-gray-500 truncate">{t.description}</p>
                          )}
                        </div>
                        <ToolPermissionBadge level={t.permission_level} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="pt-3 border-t border-gray-200 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 text-xs text-gray-600 rounded border border-gray-300 hover:bg-gray-50 cursor-pointer"
        >
          Close Panel
        </button>
      </div>
    </div>
  )
}
