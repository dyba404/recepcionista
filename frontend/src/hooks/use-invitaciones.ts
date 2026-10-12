import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Invitation, InviteLinkResult, InvitacionPublica } from '@/lib/types'

/**
 * Invitaciones por enlace (contrato endurecer-local, sección C — patrón
 * Chatwoot invite, modo sin-email):
 * - GET /api/invitaciones?tenant= (manage_team) → pendientes.
 * - POST /api/staff/invite {tenant, email, rol} (manage_team; el rol admin
 *   solo lo crea el dueño; 409 si el email ya está en el team o ya tiene
 *   invitación pendiente válida) → {token, url, expires_at}. La UI muestra
 *   el enlace para copiar; el envío por email queda TODO con Resend.
 * - DELETE /api/invitaciones/{id}?tenant= (manage_team) → revocar.
 * - GET /api/invitaciones/{token} (público) → {valida, local, email, rol}
 *   sin secrets; expirada/aceptada/revocada → valida false con motivo.
 *
 * El error de crear enlace NO se toastea aquí: la página Equipo lo muestra
 * inline verbatim (409 dup, 403 de rol…), igual que useInviteStaff.
 */

export function useInvitaciones(tenant: string, enabled = true) {
  return useQuery({
    queryKey: ['invitaciones', tenant],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<Invitation[]>('/api/invitaciones', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useInviteLink(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: { email: string; rol: 'admin' | 'staff' }) => {
      const res = await api.post<InviteLinkResult>('/api/staff/invite', {
        tenant,
        email: vars.email.trim(),
        rol: vars.rol,
      })
      return res.data
    },
    onSuccess: () => {
      // refresca la lista de pendientes (sin toast: la UI enseña el enlace)
      void queryClient.invalidateQueries({ queryKey: ['invitaciones', tenant] })
    },
  })
}

export function useRevocarInvitacion(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string | number) => {
      const res = await api.delete(`/api/invitaciones/${id}`, {
        params: { tenant },
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invitaciones', tenant] })
      toast.success('Invitación revocada', {
        description: 'El enlace deja de funcionar de inmediato.',
      })
    },
  })
}

/**
 * GET público del estado de una invitación. Un 404/410 (token desconocido o
 * expirado) se normaliza a valida:false — el backend firma el body con
 * {valida, motivo} pero también puede responder 404 directo; la página
 * /invitar es honesta en ambos casos. Sin redirect de auth: es página
 * pública (un 401 con token viejo en el store no debe botar al usuario).
 */
export function useInvitacionPublica(token: string) {
  return useQuery({
    queryKey: ['invitacion', token],
    enabled: token.length > 0,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      try {
        const res = await api.get<InvitacionPublica>(
          `/api/invitaciones/${token}`,
          { skipAuthRedirect: true }
        )
        return res.data
      } catch (err) {
        if (
          isAxiosError(err) &&
          (err.response?.status === 404 || err.response?.status === 410)
        ) {
          return {
            valida: false,
            motivo: 'La invitación no existe, expiró o ya fue aceptada.',
          } satisfies InvitacionPublica
        }
        throw err
      }
    },
  })
}
