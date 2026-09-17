import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/mcp" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
      const from = (location.state as { from?: Location } | null)?.from
      navigate(from ? `${from.pathname}${from.search}` : '/mcp', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-8">
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-8 h-8 rounded flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: '#2e9e7a' }}
          >
            AF
          </div>
          <span className="text-lg font-bold" style={{ color: '#2e9e7a' }}>
            AgentFactory
          </span>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Log in</h1>
        <p className="text-sm text-gray-500 mb-6">Welcome back. Enter your details to continue.</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2e9e7a]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2 text-sm text-white rounded-md font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#2e9e7a' }}
          >
            {submitting && (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          Don't have an account?{' '}
          <Link to="/signup" className="text-[#2e9e7a] hover:underline font-medium">
            Sign up
          </Link>
        </p>

        {/* User Onboarding Guide */}
        <div className="mt-6 pt-4 border-t border-gray-100 bg-gray-50/70 rounded-lg p-3.5 text-xs text-gray-600">
          <p className="font-semibold text-gray-800 flex items-center gap-1.5 mb-1.5">
            <span>💡</span> How to proceed once logged in:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-gray-500 leading-relaxed">
            <li><strong>MCP Registry:</strong> View servers registered by your admin and click <em>+ Connect PAT</em> to link your personal tokens.</li>
            <li><strong>+ Build:</strong> Create custom AI agents that use your connected tools (GitHub, Slack, etc.).</li>
            <li><strong>Playground:</strong> Test and chat with your agent in real-time or export its API.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
