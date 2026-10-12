import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

/**
 * POST /api/demo/reset (protegido con Bearer). Botón "Recargar demo" de
 * /locales y /panel — solo lo ofrecemos al rol owner.
 */
export function useDemoReset() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.auth.user)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/demo/reset')
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Demo recargada: pedidos seed restaurados')
    },
    onError: (err) => {
      toast.error(apiErrorDetail(err) ?? 'No se pudo recargar la demo')
    },
  })

  return { ...mutation, isOwner: user?.rol === 'owner' }
}
