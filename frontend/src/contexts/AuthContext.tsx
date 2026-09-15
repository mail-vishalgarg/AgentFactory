import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getAuthToken, registerUnauthorizedHandler, setAuthToken, type AuthUser } from '../api/client'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAuthToken()
    if (!token) {
      setLoading(false)
      return
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        setAuthToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthToken(null)
      setUser(null)
    }
    registerUnauthorizedHandler(handleUnauthorized)
    return () => registerUnauthorizedHandler(null)
  }, [])

  async function login(email: string, password: string) {
    const result = await api.login(email, password)
    setAuthToken(result.access_token)
    setUser(result.user)
  }

  async function signup(email: string, password: string) {
    const result = await api.signup(email, password)
    setAuthToken(result.access_token)
    setUser(result.user)
  }

  function logout() {
    setAuthToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
