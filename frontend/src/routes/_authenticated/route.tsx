import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { api } from '@/lib/api'
import type { AuthUser } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
  // Guardia de ruta: sin token → /sign-in. Con token pero sin user
  // (recarga de página), rehidrata la sesión con GET /api/auth/me;
  // si el token es inválido limpia el store y manda a /sign-in.
  beforeLoad: async ({ location }) => {
    const { auth } = useAuthStore.getState()

    if (!auth.accessToken) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
        replace: true,
      })
    }

    if (!auth.user) {
      try {
        const res = await api.get<AuthUser>('/api/auth/me', {
          skipAuthRedirect: true, // el 401 se maneja aquí, sin redirect doble
        })
        useAuthStore.getState().auth.setUser(res.data)
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response
          ?.status
        if (status === 401) {
          useAuthStore.getState().auth.reset()
          throw redirect({
            to: '/sign-in',
            search: { redirect: location.href },
            replace: true,
          })
        }
        // Error de red / backend caído: se deja pasar; las pantallas ya
        // muestran sus errores inline y el interceptor cubre 401 futuros.
      }
    }
  },
})
