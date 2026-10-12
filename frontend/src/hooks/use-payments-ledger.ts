import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LedgerEntry } from '@/lib/types'

/**
 * GET /api/payments/ledger?tenant= (owner, contrato saas-cola-2): los
 * últimos 100 pagos del local — una fila por cada acción de pago (cargo
 * Culqi real, webhook simulado, Yape exacto/falso).
 */
export function useLedger(tenant: string) {
  return useQuery({
    queryKey: ['payments', 'ledger', tenant],
    queryFn: async () => {
      const res = await api.get<LedgerEntry[]>('/api/payments/ledger', {
        params: { tenant },
      })
      return res.data
    },
  })
}
