import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { MeResponse, MessageResponse, User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    api
      .get<MeResponse>('/api/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user)
      })
      .catch((err: unknown) => {
        // 401 just means "not logged in"; anything else is also treated as logged out.
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.error('Auth check failed', err)
        }
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post<MessageResponse>('/api/auth/logout')
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, logout }), [user, loading, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
