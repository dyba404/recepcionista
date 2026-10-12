import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { PaymentsAccount } from '@/lib/types'

/**
 * Cuenta de la pasarela de Culqi del local (contrato pasarela-culqi):
 * - GET /api/payments/cuenta?tenant= (Bearer): estado, llave pública
 *   ENMASCARADA y verified_at.
 * - POST /api/payments/cuenta {tenant, public_key, secret_key} (owner):
 *   valida las llaves contra Culqi y conecta. Un 400 trae el rechazo
 *   tal cual ("Llave secreta rechazada por Culqi: …") — la página lo
 *   muestra inline, así que este hook NO toastea errores de conexión.
 * - DELETE /api/payments/cuenta?tenant= (owner): desconecta.
 */

export function usePaymentsAccount(tenant: string) {
  return useQuery({
    queryKey: ['payments', 'cuenta', tenant],
    queryFn: async () => {
      const res = await api.get<PaymentsAccount>('/api/payments/cuenta', {
        params: { tenant },
      })
      return res.data
    },
  })
}

/**
 * Al conectar/desconectar hay que refrescar DOS caches: la cuenta (badge
 * de /configuracion/pagos) y la config pública (culqi_pk del paybox del
 * chat de cliente, que pasa de simulado a real y viceversa).
 */
function useInvalidarPasarela(tenant: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: ['payments', 'cuenta', tenant],
    })
    void queryClient.invalidateQueries({ queryKey: ['pay-config', tenant] })
  }
}

export function useConnectPaymentsAccount(tenant: string) {
  const invalidar = useInvalidarPasarela(tenant)

  return useMutation({
    mutationFn: async (vars: { publicKey: string; secretKey: string }) => {
      const res = await api.post('/api/payments/cuenta', {
        tenant,
        public_key: vars.publicKey,
        secret_key: vars.secretKey,
      })
      return res.data
    },
    onSuccess: () => {
      invalidar()
      toast.success('Pasarela conectada', {
        description:
          'Culqi validó las llaves: el chat del cliente ya cobra con tarjeta real.',
      })
    },
  })
}

export function useDisconnectPaymentsAccount(tenant: string) {
  const invalidar = useInvalidarPasarela(tenant)

  return useMutation({
    mutationFn: async () => {
      const res = await api.delete('/api/payments/cuenta', {
        params: { tenant },
      })
      return res.data
    },
    onSuccess: () => {
      invalidar()
      toast.success('Pasarela desconectada', {
        description:
          'El chat del cliente vuelve al cobro simulado hasta que reconectes.',
      })
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo desconectar la pasarela')
    },
  })
}
