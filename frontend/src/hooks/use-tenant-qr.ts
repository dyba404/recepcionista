import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

/**
 * QR de Yape real del local (contrato saas-cola-2):
 * POST /api/tenants/{id}/qr (owner) con multipart "file" (png/jpg, máx 2MB).
 * La imagen la sirve GET /api/tenants/{id}/qr y /api/payments/config la
 * anuncia con `yape_qr_imagen` — por eso invalidamos la config pública al
 * subir: el paybox del chat de cliente pasa del QR generado al real.
 *
 * Los errores NO se toastean aquí: la sección de /configuracion/pagos los
 * muestra inline tal cual.
 */
export function useUploadQrYape(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      // Multipart de verdad: sin este header, el default JSON de la
      // instancia haría que axios serializara el FormData como JSON.
      // Con él, axios lo deja pasar y el navegador pone el boundary.
      const res = await api.post(
        `/api/tenants/${encodeURIComponent(tenant)}/qr`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pay-config', tenant] })
      toast.success('QR de Yape actualizado', {
        description: 'El chat de cliente ya muestra tu QR real al pagar.',
      })
    },
  })
}
