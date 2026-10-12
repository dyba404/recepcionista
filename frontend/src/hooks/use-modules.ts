import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, apiErrorDetail } from '@/lib/api'
import type { ModuleConfig } from '@/lib/types'

/**
 * Gating de módulos (contrato modulos-mvp):
 * - GET /api/modules?tenant= (Bearer) — lista con enabled/server_gated.
 * - PATCH /api/modules/{key} {tenant, enabled} — solo owner; 403 si staff.
 *
 * `isEnabled` es fail-open: mientras la lista carga (o si falla) no
 * ocultamos navegación — un flash de sidebar sería peor que un ítem de
 * más durante el arranque.
 */

/** Keys de los módulos del MVP (contrato con el backend). */
export const MODULE_KEYS = {
  WHATSAPP: 'whatsapp',
  INBOX: 'inbox',
  PAGOS: 'pagos',
  KDS: 'kds',
  CARTA: 'carta',
} as const

/** Tenant de la sesión (el owner/staff siempre pertenece a un local). */
export function useCurrentTenant(): string {
  const tenantId = useAuthStore((s) => s.auth.user?.tenant_id)
  return tenantId ?? 'faro'
}

export function useModules() {
  const tenant = useCurrentTenant()

  const query = useQuery({
    queryKey: ['modules', tenant],
    queryFn: async () => {
      const res = await api.get<ModuleConfig[]>('/api/modules', {
        params: { tenant },
      })
      return res.data
    },
    staleTime: 30_000,
  })

  const isEnabled = (key: string): boolean => {
    if (query.isPending || query.isError) return true
    const mod = query.data?.find((m) => m.key === key)
    return mod ? mod.enabled : true
  }

  // Campos explícitos (no spread del query): evita que los consumidores
  // re-observen todo el estado de la query.
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    tenant,
    isEnabled,
  }
}

/**
 * PATCH de un módulo con actualización optimista y rollback visual:
 * si el backend rechaza (403 de staff, error…), se restaura el estado
 * previo y el toast muestra el `detail` real.
 */
export function useToggleModule() {
  const queryClient = useQueryClient()
  const tenant = useCurrentTenant()

  return useMutation({
    mutationFn: async (vars: { key: string; enabled: boolean }) => {
      const res = await api.patch(`/api/modules/${vars.key}`, {
        tenant,
        enabled: vars.enabled,
      })
      return res.data
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['modules', tenant] })
      const previous = queryClient.getQueryData<ModuleConfig[]>([
        'modules',
        tenant,
      ])
      queryClient.setQueryData<ModuleConfig[]>(['modules', tenant], (old) =>
        old?.map((m) =>
          m.key === vars.key ? { ...m, enabled: vars.enabled } : m
        )
      )
      return { previous }
    },
    onError: (error, vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['modules', tenant], ctx.previous)
      }
      toast.error(apiErrorDetail(error) ?? 'No se pudo actualizar el módulo', {
        description: vars.enabled
          ? 'El módulo sigue desactivado.'
          : 'El módulo sigue activado.',
      })
    },
    onSuccess: (_data, vars) => {
      toast.success(
        vars.enabled
          ? 'Módulo activado — ya es visible para el equipo.'
          : 'Módulo desactivado — oculto en la navegación.'
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['modules', tenant] })
    },
  })
}
