import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { PlanInfo } from '@/lib/types'

/**
 * Planes del SaaS (contrato endurecer-local, sección E):
 * - GET /api/planes (público): [{id, nombre, precio, detalle}] — trial,
 *   basico, pro. Sin Bearer: la página /planes es pública.
 * - PATCH /api/tenants/{id}/plan {plan} (owner): activación MANUAL — el
 *   cobro real queda pendiente de Culqi Suscripciones (nota honesta del
 *   contrato). Invalida ['tenants'] para que el badge del dashboard y la
 *   marca "Plan actual" refresquen al vuelo.
 */
export function usePlanes() {
  return useQuery({
    queryKey: ['planes'],
    queryFn: async () => {
      const res = await api.get<PlanInfo[]>('/api/planes', {
        // pública: un 401 (p.ej. token vencido en el store) no debe botar
        // a nadie de la página de precios
        skipAuthRedirect: true,
      })
      return res.data
    },
  })
}

export function useCambiarPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: { tenant: string; plan: string }) => {
      const res = await api.patch<{ nota?: string }>(
        `/api/tenants/${vars.tenant}/plan`,
        { plan: vars.plan }
      )
      return res.data
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
      // Nota honesta del contrato: el cobro automático aún no existe.
      toast.success('Plan activado en modo manual', {
        description:
          data?.nota ?? 'El cobro automático llega con Culqi Suscripciones.',
      })
    },
    onError: (err) => {
      toast.error('No se pudo activar el plan', {
        description: apiErrorDetail(err) ?? 'Inténtalo de nuevo en un momento.',
      })
    },
  })
}
