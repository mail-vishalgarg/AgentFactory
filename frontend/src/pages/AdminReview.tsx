import { useEffect, useState } from 'react'
import { api, type MarketplaceTool, type PendingListing } from '../api/client'

const gradeStyle: Record<string, string> = {
  A: 'bg-[#e6f7f2] text-[#2e9e7a]',
  B: 'bg-[#e6f7f2] text-[#2e9e7a]',
  C: 'bg-amber-50 text-amber-700',
  D: 'bg-amber-50 text-amber-700',
  F: 'bg-red-50 text-red-600',
}

const TOOLS_PREVIEW_COUNT = 3

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function ToolChip({ tool }: { tool: MarketplaceTool }) {
  return (
    <span
      className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono flex items-center gap-1 whitespace-nowrap"
      title={tool.tool_description}
    >
      {tool.mcp_server_name}.{tool.tool_name}
      {(tool.permission_level === 'write' || tool.permission_level === 'destructive') && (
        <span className={tool.requires_approval ? 'text-[#2e9e7a]' : 'text-red-500'}>
          {tool.requires_approval ? '✓' : '✕'}
        </span>
      )}
    </span>
  )
}

function ToolChips({ tools }: { tools: MarketplaceTool[] }) {
  const [expanded, setExpanded] = useState(false)
  const overflow = tools.length - TOOLS_PREVIEW_COUNT
  const visible = expanded ? tools : tools.slice(0, TOOLS_PREVIEW_COUNT)

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((t) => (
        <ToolChip key={`${t.mcp_server_name}.${t.tool_name}`} tool={t} />
      ))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-[#2e9e7a] hover:underline font-medium whitespace-nowrap"
        >
          {expanded ? 'Show less' : `+${overflow} more`}
        </button>
      )}
    </div>
  )
}

interface ListingRowProps {
  listing: PendingListing
  onDecided: (id: string) => void
}

function ListingRow({ listing, onDecided }: ListingRowProps) {
  const [notes, setNotes] = useState('')
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | 'changes_requested' | null>(null)
  const [error, setError] = useState('')

  async function handleDecide(decision: 'approved' | 'rejected' | 'changes_requested') {
    setDeciding(decision)
    setError('')
    try {
      await api.decideListing(listing.id, decision, notes.trim() || undefined)
      onDecided(listing.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not record that decision.')
      setDeciding(null)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
      {/* Identity, badges, and thread meta — one horizontal line */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-semibold text-gray-900 whitespace-nowrap">{listing.name}</span>
        <span className="text-sm text-gray-500 truncate flex-1 min-w-[140px]">{listing.description}</span>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
          Score {listing.score}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
          Gov {listing.governance_grade}
        </span>
        <span className="text-xs text-gray-400 whitespace-nowrap">{listing.publisher_org}</span>

        <span className="flex items-center gap-1.5 text-xs text-gray-400 font-mono whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
          Waiting {timeAgo(listing.submitted_at).replace(' ago', '')}
          <span className="text-gray-300">·</span>
          <span title={listing.thread_id}>thr_{listing.thread_id.slice(0, 8)}…</span>
        </span>
      </div>

      {/* Tools — capped preview with show more/less */}
      <ToolChips tools={listing.tools} />

      {error && (
        <div className="px-2.5 py-1.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          {error}
        </div>
      )}

      {/* Notes + actions — one horizontal line */}
      <div className="flex items-center gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes for the publisher…"
          className="flex-1 min-w-[120px] border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
        />
        <button
          onClick={() => handleDecide('approved')}
          disabled={deciding !== null}
          className="px-3 py-1.5 text-xs text-white rounded-md font-medium disabled:opacity-60 whitespace-nowrap"
          style={{ backgroundColor: '#2e9e7a' }}
        >
          {deciding === 'approved' ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => handleDecide('changes_requested')}
          disabled={deciding !== null}
          className="px-3 py-1.5 text-xs text-amber-700 rounded-md border border-amber-300 hover:bg-amber-50 font-medium disabled:opacity-60 whitespace-nowrap"
        >
          {deciding === 'changes_requested' ? 'Sending…' : 'Request changes'}
        </button>
        <button
          onClick={() => handleDecide('rejected')}
          disabled={deciding !== null}
          className="px-3 py-1.5 text-xs text-gray-700 rounded-md border border-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 font-medium disabled:opacity-60 whitespace-nowrap"
        >
          {deciding === 'rejected' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  )
}

export default function AdminReview() {
  const [listings, setListings] = useState<PendingListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listPendingListings()
      .then(setListings)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the review queue.')
      )
      .finally(() => setLoading(false))
  }, [])

  function handleDecided(id: string) {
    setListings((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Admin Review</h1>
        {!loading && !error && listings.length > 0 && (
          <span className="text-sm text-gray-400">{listings.length} pending</span>
        )}
      </div>
      <p className="text-sm text-gray-500 -mt-4 mb-6">
        Agents submitted for the Marketplace. Approving publishes them for everyone; rejecting
        sends them back to the publisher's workspace as a draft.
      </p>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded max-w-md">
          {error}
        </div>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">Nothing pending.</p>
          <p className="text-sm mt-1">Submissions will show up here as soon as someone publishes.</p>
        </div>
      )}

      <div className="space-y-2">
        {listings.map((listing) => (
          <ListingRow key={listing.id} listing={listing} onDecided={handleDecided} />
        ))}
      </div>
    </div>
  )
}
