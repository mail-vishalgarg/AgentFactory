import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50 text-gray-500 text-sm">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-[#2e9e7a]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Loading workspace…</span>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}
