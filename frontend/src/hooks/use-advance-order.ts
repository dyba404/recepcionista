import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { Order } from '@/lib/types'

/**
 * Avance de estado con actualización OPTIMISTA y ROLLBACK:
 * mueve la tarjeta al estado propuesto al instante; si el PATCH responde
 * 400 (anti Yape-falso) revierte al snapshot previo y muestra el detail
 * del backend como toast destructive.
 */
export function useAdvanceOrder(scope: string) {
  const queryClient = useQueryClient()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const advance = useCallback(
    async (orderId: string, target: Order['estado']) => {
      const queryKey = ['orders', scope]
      const previous = queryClient.getQueryData<Order[]>(queryKey)

      // 1) actualización optimista en la caché
      queryClient.setQueryData<Order[]>(queryKey, (old) =>
        old?.map((o) => (o.id === orderId ? { ...o, estado: target } : o))
      )
      setPendingIds((prev) => new Set(prev).add(orderId))

      try {
        // 2) PATCH real; el backend puede rechazar con 400 anti-fraude
        const res = await api.patch<Order>(`/api/orders/${orderId}`, {
          estado: target,
        })
        // 3) reconciliar con la respuesta del servidor (timeline, pago…)
        queryClient.setQueryData<Order[]>(queryKey, (old) =>
          old?.map((o) => (o.id === orderId ? { ...o, ...res.data } : o))
        )
        return true
      } catch (err) {
        // 4) rollback: restaurar el snapshot previo + toast destructive
        queryClient.setQueryData(queryKey, previous)
        void queryClient.invalidateQueries({ queryKey: ['orders'] })
        const detail =
          apiErrorDetail(err) ??
          (err instanceof AxiosError && err.response?.status === 400
            ? 'No se puede avanzar sin pago verificado'
            : undefined)
        toast.error(detail ?? 'No se pudo avanzar el pedido', {
          description:
            detail === undefined
              ? 'Revisa tu conexión e inténtalo de nuevo.'
              : undefined,
        })
        return false
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(orderId)
          return next
        })
      }
    },
    [queryClient, scope]
  )

  const isPending = useCallback(
    (orderId: string) => pendingIds.has(orderId),
    [pendingIds]
  )

  return { advance, isPending }
}
