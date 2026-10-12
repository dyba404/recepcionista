import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MenuResponse } from '@/lib/types'
import { TENANT_IDS } from '@/lib/order-utils'

/**
 * Mapa id de plato → nombre (ej. f1 → "Ceviche clásico") construido desde
 * GET /api/menu por tenant. El contrato de pedidos solo trae items
 * [{id, cant}], así que el nombre se resuelve en cliente.
 */
export function useDishNames(): Record<string, string> {
  const [faroQ, brasaQ, juanaQ] = useQueries({
    queries: TENANT_IDS.map((tenant) => ({
      queryKey: ['menu', tenant],
      queryFn: async () => {
        const res = await api.get<MenuResponse>('/api/menu', {
          params: { tenant },
        })
        return res.data
      },
      staleTime: 5 * 60 * 1000,
    })),
  })

  // Mapa id→nombre; 3 menús pequeños, reconstruir por render es trivial.
  const map: Record<string, string> = {}
  for (const q of [faroQ, brasaQ, juanaQ]) {
    for (const item of q.data?.items ?? []) {
      map[item.id] = item.nombre
    }
  }
  return map
}
