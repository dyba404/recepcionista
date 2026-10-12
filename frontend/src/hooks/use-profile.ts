import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AuthUser } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Perfil editable (contrato horarios-pausa-notif-perfil, D):
 * PATCH /api/auth/me {nombre?, password_actual?, password_nueva?}.
 *
 * - nombre: siempre editable.
 * - contraseña: exige password_actual correcta (400 "Contraseña actual
 *   incorrecta") y password_nueva de 8+ (422). Tras cambiarla el token
 *   viejo SIGUE válido (JWT stateless) — no hay que reloguear.
 *
 * Devuelve el user actualizado: se refleja en el auth-store (header,
 * sidebar, ProfileDropdown) y en la caché ['me'] de la página de perfil.
 * Los errores NO se toastean aquí — los dialogs los muestran verbatim
 * inline (contrato: "Contraseña actual incorrecta" tal cual).
 */
export function useUpdateMe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      nombre?: string
      password_actual?: string
      password_nueva?: string
    }) => {
      const res = await api.patch<AuthUser>('/api/auth/me', vars)
      return res.data
    },
    onSuccess: (user) => {
      useAuthStore.getState().auth.setUser(user)
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
}
