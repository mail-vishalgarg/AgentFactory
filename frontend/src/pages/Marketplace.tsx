import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type MarketplaceListing } from '../api/client'

const gradeStyle: Record<string, string> = {
  A: 'bg-[#e6f7f2] text-[#2e9e7a]',
  B: 'bg-[#e6f7f2] text-[#2e9e7a]',
  C: 'bg-amber-50 text-amber-700',
  D: 'bg-amber-50 text-amber-700',
  F: 'bg-red-50 text-red-600',
}

export default function Marketplace() {
  const navigate = useNavigate()
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listMarketplace().then(setListings).finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Marketplace</h1>
        <p className="text-sm text-gray-500 mt-1">
          Agents other workspaces published and an admin approved. Install one to get your own copy.
        </p>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!loading && listings.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">Nothing published yet.</p>
          <p className="text-sm mt-1">Approved agents from any workspace will show up here.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <div
            key={listing.id}
            onClick={() => navigate(`/marketplace/${listing.id}`)}
            className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
          >
            <span className="font-semibold text-gray-900 truncate">{listing.name}</span>
            <p className="text-sm text-gray-500 line-clamp-2">{listing.description}</p>

            <div className="flex flex-wrap gap-1">
              {listing.tools.slice(0, 3).map((t) => (
                <span
                  key={`${t.mcp_server_name}.${t.tool_name}`}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono"
                >
                  {t.mcp_server_name}.{t.tool_name}
                </span>
              ))}
              {listing.tools.length > 3 && (
                <span className="text-xs text-gray-400">+{listing.tools.length - 3} more</span>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
                Score {listing.score}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
                {listing.governance_grade}
              </span>
              <span className="text-xs text-gray-400 ml-auto">
                {listing.publisher_org} · {listing.install_count} install{listing.install_count === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
