import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.'
  if (!/[A-Za-z]/.test(password)) return 'Password must contain at least one letter.'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.'
  return null
}

export default function SignupPage() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/mcp" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await signup(email, password)
      navigate('/mcp', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed')
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

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Create an account</h1>
        <p className="text-sm text-gray-500 mb-6">Register a company/user to start building agents.</p>

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
            <p className="text-xs text-gray-400 mt-1">
              At least 8 characters, with a letter, a number, and a special character.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
            <input
              required
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-[#2e9e7a] hover:underline font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
