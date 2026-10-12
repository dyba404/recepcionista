import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Order } from '@/lib/types'

/**
 * Cola de pedidos vía GET /api/orders (requiere Bearer).
 * scope: 'todos' | tenant id | 'kds' — es el segmento del queryKey, de modo
 * que cada pantalla (panel con filtro, cocina sin filtro) tiene su caché y
 * el WS invalida el prefijo ['orders'] para todas a la vez.
 */
export function useOrders(scope: string) {
  return useQuery({
    queryKey: ['orders', scope],
    queryFn: async () => {
      const res = await api.get<Order[]>('/api/orders', {
        params: scope !== 'todos' && scope !== 'kds' ? { tenant: scope } : {},
      })
      return res.data
    },
  })
}
