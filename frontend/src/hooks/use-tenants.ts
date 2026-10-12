import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Tenant } from '@/lib/types'

/** GET /api/tenants (público): los 3 locales para /locales. */
export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const res = await api.get<Tenant[]>('/api/tenants')
      return res.data
    },
  })
}
