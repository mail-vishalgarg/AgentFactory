import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type MarketplaceListing } from '../api/client'

export default function MarketplaceListingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [listing, setListing] = useState<MarketplaceListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.getMarketplaceListing(id).then(setListing).finally(() => setLoading(false))
  }, [id])

  async function handleInstall() {
    if (!id) return
    setInstalling(true)
    setError('')
    try {
      const agent = await api.installListing(id)
      navigate(`/agents/${agent.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
      setInstalling(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!listing) return <div className="p-8 text-red-500">Listing not found.</div>

  const servers = Array.from(new Set(listing.tools.map((t) => t.mcp_server_name)))

  return (
    <div className="p-8 max-w-3xl">
      <Link to="/marketplace" className="text-sm text-gray-500 hover:text-gray-700">← Marketplace</Link>

      <div className="flex items-start justify-between mt-3 mb-1">
        <h1 className="text-2xl font-semibold text-gray-900">{listing.name}</h1>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-60"
          style={{ backgroundColor: '#2e9e7a' }}
        >
          {installing ? 'Installing…' : 'Add to my workspace'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">{listing.description}</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded">{error}</div>
      )}

      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#e6f7f2] text-[#2e9e7a]">
          Score {listing.score}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#e6f7f2] text-[#2e9e7a]">
          Governance {listing.governance_grade}
        </span>
        <span className="text-xs text-gray-400">
          Published by {listing.publisher_org} · {listing.install_count} install{listing.install_count === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Needs your own credentials for</p>
        <div className="flex flex-wrap gap-2">
          {servers.map((s) => (
            <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-mono">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tools</p>
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tool</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Access</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Before it runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listing.tools.map((t) => (
                <tr key={`${t.mcp_server_name}.${t.tool_name}`}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{t.mcp_server_name}.{t.tool_name}</td>
                  <td className="px-4 py-2 text-gray-600">{t.permission_level}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {t.requires_approval ? 'asks a human' : 'runs automatically'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
