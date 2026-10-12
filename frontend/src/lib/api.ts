import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Instancia axios compartida: inyecta `Authorization: Bearer <jwt>` desde el
 * auth-store y, ante un 401 fuera de las páginas de auth, limpia la sesión y
 * regresa a /sign-in. Las rutas públicas siguen funcionando igual (sin token
 * en el store no se manda header).
 */
export const api = axios.create({
  // baseURL relativo: el proxy de Vite ya manda /api y /static al backend
  headers: { 'Content-Type': 'application/json' },
})

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Omitir el redirect automático a /sign-in en un 401 (login, /me…). */
    skipAuthRedirect?: boolean
  }
}

// Rutas de auth vivas: en ellas un 401 es error del formulario, no logout.
const AUTH_PATHS = ['/sign-in']

function isOnAuthPage(): boolean {
  const { pathname } = window.location
  return AUTH_PATHS.some((p) => pathname.startsWith(p))
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.skipAuthRedirect &&
      !isOnAuthPage()
    ) {
      useAuthStore.getState().auth.reset()
      const { pathname, search } = window.location
      const redirect = encodeURIComponent(pathname + search)
      window.location.assign(`/sign-in?redirect=${redirect}`)
    }
    return Promise.reject(error)
  }
)

/** Extrae `detail` del body de error del backend (FastAPI), si viene. */
export function apiErrorDetail(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    const detail = (
      error.response?.data as { detail?: unknown } | undefined
    )?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return undefined
}

/**
 * ¿El error es el 403 de módulo desactivado? El contrato modulos-mvp firma
 * esos 403 con `{"detail":"Módulo desactivado: actívalo en Configuración"}`.
 * Un 403 sin detail en un GET de módulo también lo tratamos como gating
 * (es la única causa prevista de 403 en lectura).
 */
export function isModuleDisabledError(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false
  if (error.response?.status !== 403) return false
  const detail = apiErrorDetail(error)?.toLowerCase()
  if (!detail) return true
  return detail.includes('módulo desactivado') || detail.includes('modulo desactivado')
}
