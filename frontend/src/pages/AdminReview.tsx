import { useEffect, useState } from 'react'
import { api, type PendingListing } from '../api/client'

const gradeStyle: Record<string, string> = {
  A: 'bg-[#e6f7f2] text-[#2e9e7a]',
  B: 'bg-[#e6f7f2] text-[#2e9e7a]',
  C: 'bg-amber-50 text-amber-700',
  D: 'bg-amber-50 text-amber-700',
  F: 'bg-red-50 text-red-600',
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface ListingCardProps {
  listing: PendingListing
  onDecided: (id: string) => void
}

function ListingCard({ listing, onDecided }: ListingCardProps) {
  const [notes, setNotes] = useState('')
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState('')

  async function handleDecide(decision: 'approved' | 'rejected') {
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
    <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-semibold text-gray-900">{listing.name}</span>
          <p className="text-sm text-gray-500 mt-0.5">{listing.description}</p>
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {timeAgo(listing.submitted_at)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {listing.tools.map((t) => (
          <span
            key={`${t.mcp_server_name}.${t.tool_name}`}
            className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono flex items-center gap-1"
            title={t.tool_description}
          >
            {t.mcp_server_name}.{t.tool_name}
            {(t.permission_level === 'write' || t.permission_level === 'destructive') && (
              <span className={t.requires_approval ? 'text-[#2e9e7a]' : 'text-red-500'}>
                {t.requires_approval ? '✓' : '✕'}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
          Score {listing.score}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${gradeStyle[listing.governance_grade] ?? 'bg-gray-100 text-gray-600'}`}>
          Governance {listing.governance_grade}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{listing.publisher_org}</span>
      </div>

      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
          {error}
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes for the publisher…"
        rows={2}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
      />

      <div className="flex gap-2">
        <button
          onClick={() => handleDecide('approved')}
          disabled={deciding !== null}
          className="flex-1 px-3 py-1.5 text-sm text-white rounded-md font-medium disabled:opacity-60"
          style={{ backgroundColor: '#2e9e7a' }}
        >
          {deciding === 'approved' ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => handleDecide('rejected')}
          disabled={deciding !== null}
          className="flex-1 px-3 py-1.5 text-sm text-gray-700 rounded-md border border-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 font-medium disabled:opacity-60"
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Admin Review</h1>
        <p className="text-sm text-gray-500 mt-1">
          Agents submitted for the Marketplace. Approving publishes them for everyone; rejecting
          sends them back to the publisher's workspace as a draft.
        </p>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} onDecided={handleDecided} />
        ))}
      </div>
    </div>
  )
}
