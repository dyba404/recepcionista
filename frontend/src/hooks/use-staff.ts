import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { StaffMember } from '@/lib/types'

/**
 * Equipo del local (contratos saas-cola-2 + roles-equipo):
 * - GET /api/staff?tenant= (owner/admin) → [{id,email,nombre,rol}].
 * - POST /api/staff {tenant,email,password,nombre,rol} (manage_team; el rol
 *   "admin" solo lo puede invitar el dueño — el backend responde 403
 *   "Tu rol no permite manage_team" u otro detalle si algo no cuadra).
 * - PATCH /api/staff/{id} {tenant,rol} (manage_team): cambio de rol en línea
 *   (staff↔admin). Guardas del backend: no tocar owners, no auto-desasignarse
 *   el último dueño, admin no toca admins.
 * - DELETE /api/staff/{user_id}?tenant= (manage_team; no a sí mismo; nunca
 *   owners; admin solo baja staff).
 *
 * Los errores de invitar/cambiar rol/eliminar NO se toastean aquí: la página
 * Equipo los muestra inline tal cual (409, "último dueño", 403 de rol…),
 * igual que useConnectPaymentsAccount con el rechazo de Culqi. Los éxitos
 * sí toastean e invalidan ['staff', tenant].
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
      /** "admin" solo lo invita el dueño; default backend: "staff". */
      rol?: 'admin' | 'staff'
    }) => {
      const res = await api.post('/api/staff', {
        tenant,
        email: vars.email.trim(),
        password: vars.password,
        nombre: vars.nombre.trim(),
        rol: vars.rol ?? 'staff',
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['staff', tenant] })
      toast.success(
        `${vars.nombre.trim() || vars.email.trim()} ya es parte del equipo`,
        {
          description:
            vars.rol === 'admin'
              ? 'Entra con su correo y contraseña como administrador.'
              : 'Puede entrar con su correo y contraseña.',
        }
      )
    },
  })
}

/**
 * Cambio de rol/nombre en línea (PATCH /api/staff/{id}), con actualización
 * optimista y rollback visual si el backend rechaza (patrón useToggleModule):
 * el error lo muestra inline la página Equipo (verbatim).
 */
export function useUpdateStaff(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      userId: string | number
      rol?: 'admin' | 'staff'
      nombre?: string
    }) => {
      const res = await api.patch(`/api/staff/${vars.userId}`, {
        tenant,
        ...(vars.rol ? { rol: vars.rol } : {}),
        ...(vars.nombre !== undefined ? { nombre: vars.nombre } : {}),
      })
      return res.data
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['staff', tenant] })
      const previous = queryClient.getQueryData<StaffMember[]>([
        'staff',
        tenant,
      ])
      // const: mantiene el narrowing de rol dentro del callback de setQueryData
      const { rol } = vars
      if (rol) {
        queryClient.setQueryData<StaffMember[]>(['staff', tenant], (old) =>
          old?.map((m) => (m.id === vars.userId ? { ...m, rol } : m))
        )
      }
      return { previous }
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['staff', tenant], ctx.previous)
      }
    },
    onSuccess: (_data, vars) => {
      if (vars.rol) {
        toast.success(
          `${vars.nombre || 'Integrante'} ahora es ${vars.rol === 'admin' ? 'administrador' : 'staff'}`,
          { description: 'El cambio aplica de inmediato en el local.' }
        )
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff', tenant] })
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
