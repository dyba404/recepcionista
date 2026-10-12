import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { PayConfig } from '@/lib/types'

/**
 * GET /api/payments/config?tenant= (público): culqi_pk (vacío = simulado)
 * y el código Yape del local para el QR del paybox del chat de cliente.
 */
export function usePayConfig(tenant: string, enabled = true) {
  return useQuery({
    queryKey: ['pay-config', tenant],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await api.get<PayConfig>('/api/payments/config', {
        params: { tenant },
      })
      return res.data
    },
  })
}
