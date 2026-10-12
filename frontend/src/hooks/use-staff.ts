import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { StaffMember } from '@/lib/types'

/**
 * Equipo del local (contrato saas-cola-2):
 * - GET /api/staff?tenant= (owner) → [{id,email,nombre,rol}].
 * - POST /api/staff {tenant,email,password,nombre} (owner, 8+ chars, 409 dup).
 * - DELETE /api/staff/{user_id}?tenant= (owner; no a sí mismo; solo staff).
 *
 * Los errores de invitar/eliminar NO se toastean aquí: la página Equipo los
 * muestra inline tal cual (409, "no puedes eliminarte"…), igual que
 * useConnectPaymentsAccount con el rechazo de Culqi.
 */

export function useStaff(tenant: string, enabled = true) {
  return useQuery({
    queryKey: ['staff', tenant],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<StaffMember[]>('/api/staff', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useInviteStaff(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      email: string
      password: string
      nombre: string
    }) => {
      const res = await api.post('/api/staff', {
        tenant,
        email: vars.email.trim(),
        password: vars.password,
        nombre: vars.nombre.trim(),
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['staff', tenant] })
      toast.success(`${vars.nombre.trim() || vars.email.trim()} ya es parte del equipo`, {
        description: 'Puede entrar con su correo y contraseña.',
      })
    },
  })
}

export function useRemoveStaff(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string | number) => {
      const res = await api.delete(`/api/staff/${userId}`, {
        params: { tenant },
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff', tenant] })
      toast.success('Integrante eliminado del equipo')
    },
  })
}
