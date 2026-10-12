import { create } from 'zustand'
import type { AuthUser } from '@/lib/types'

/**
 * Token persistido en localStorage (el ADR 0002 pide JWT con exp 24h; el
 * token sobrevive recargas y el user se rehidrata vía GET /api/auth/me).
 */
const ACCESS_TOKEN_KEY = 'chatbot.access_token'

interface AuthState {
  auth: {
    user: AuthUser | null
    accessToken: string
    setUser: (user: AuthUser | null) => void
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

function readStoredToken(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
}

function clearStoredToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    accessToken: readStoredToken(),
    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),
    setAccessToken: (accessToken) =>
      set((state) => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
        }
        return { ...state, auth: { ...state.auth, accessToken } }
      }),
    resetAccessToken: () =>
      set((state) => {
        clearStoredToken()
        return { ...state, auth: { ...state.auth, accessToken: '' } }
      }),
    reset: () =>
      set((state) => {
        clearStoredToken()
        return {
          ...state,
          auth: { ...state.auth, user: null, accessToken: '' },
        }
      }),
  },
}))
