import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { KnowledgeEntry } from '@/lib/types'

/**
 * Base de conocimiento del local (contrato carta-inventario-bot):
 * - GET /api/kb?tenant= (Bearer) → entradas [{id, tema, contenido, activo}].
 *   El bot inyecta las activas al prompt (bloque INFORMACION DEL LOCAL) y
 *   responde los intents de horario/ubicación con su contenido.
 * - POST /api/kb?tenant= {tema, contenido} (manage_settings).
 * - PATCH /api/kb/{id} {tema?, contenido?, activo?} (manage_settings) —
 *   cambio de tema/contenido en el dialog y toggle activo en línea.
 * - DELETE /api/kb/{id}?tenant= (manage_settings).
 *
 * Los errores NO se toastean aquí: la página BaseDeConocimiento los muestra
 * verbatim (inline en la fila o en el dialog, patrón Equipo/Carta). El
 * toggle activo usa actualización optimista con rollback (patrón
 * useToggleModule). Los éxitos invalidan ['kb', tenant]; los toasts los
 * dispara quien llama con los callbacks de cada mutate.
 */

export function useKnowledge(tenant: string) {
  return useQuery({
    queryKey: ['kb', tenant],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<KnowledgeEntry[]>('/api/kb', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useCreateKnowledge(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: { tema: string; contenido: string }) => {
      // Contrato: tenant por query (?tenant=); va también en el body porque
      // los POST de este repo (staff, menu) lo llevan ahí — pydantic ignora
      // campos extra, así ambas formas de backend funcionan.
      const res = await api.post(
        '/api/kb',
        { tenant, tema: vars.tema, contenido: vars.contenido },
        { params: { tenant } }
      )
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kb', tenant] })
    },
  })
}

export function useUpdateKnowledge(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      id: string | number
      tema?: string
      contenido?: string
      activo?: boolean
    }) => {
      const res = await api.patch(`/api/kb/${vars.id}`, {
        ...(vars.tema !== undefined ? { tema: vars.tema } : {}),
        ...(vars.contenido !== undefined ? { contenido: vars.contenido } : {}),
        ...(vars.activo !== undefined ? { activo: vars.activo } : {}),
      })
      return res.data
    },
    onMutate: async (vars) => {
      // Toggle activo: optimista con rollback visual (patrón useToggleModule)
      await queryClient.cancelQueries({ queryKey: ['kb', tenant] })
      const previous = queryClient.getQueryData<KnowledgeEntry[]>([
        'kb',
        tenant,
      ])
      // const: mantiene el narrowing de activo dentro del setQueryData
      const { activo } = vars
      if (activo !== undefined) {
        queryClient.setQueryData<KnowledgeEntry[]>(['kb', tenant], (old) =>
          old?.map((e) => (e.id === vars.id ? { ...e, activo } : e))
        )
      }
      return { previous }
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['kb', tenant], ctx.previous)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kb', tenant] })
    },
  })
}

export function useRemoveKnowledge(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string | number) => {
      const res = await api.delete(`/api/kb/${id}`, {
        params: { tenant },
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kb', tenant] })
    },
  })
}
