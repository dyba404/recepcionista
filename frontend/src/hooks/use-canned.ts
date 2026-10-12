import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { CannedResponse } from '@/lib/types'
import { useCurrentTenant } from '@/hooks/use-modules'

/**
 * Respuestas rápidas (canned) del tenant: GET /api/canned?tenant=,
 * POST {shortcut,texto}, DELETE /api/canned/{id}. El picker del composer
 * las lista y las gestiona inline (añadir/eliminar).
 */
export function useCanned() {
  const tenant = useCurrentTenant()

  return useQuery({
    queryKey: ['canned', tenant],
    queryFn: async () => {
      const res = await api.get<CannedResponse[]>('/api/canned', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useAddCanned() {
  const queryClient = useQueryClient()
  const tenant = useCurrentTenant()

  return useMutation({
    mutationFn: async (vars: { shortcut: string; texto: string }) => {
      const res = await api.post<CannedResponse>('/api/canned', {
        shortcut: vars.shortcut,
        texto: vars.texto,
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['canned', tenant] })
      toast.success('Respuesta rápida agregada')
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo agregar la respuesta')
    },
  })
}

export function useDeleteCanned() {
  const queryClient = useQueryClient()
  const tenant = useCurrentTenant()

  return useMutation({
    mutationFn: async (id: string | number) => {
      const res = await api.delete(`/api/canned/${id}`)
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['canned', tenant] })
      toast.success('Respuesta rápida eliminada')
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo eliminar la respuesta')
    },
  })
}
