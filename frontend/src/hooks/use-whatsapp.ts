import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { WebhookResult, WhatsAppStatus } from '@/lib/types'

/**
 * Canal WhatsApp (contrato modulos-mvp):
 * - GET /api/whatsapp/status?tenant= (con polling opcional para el paso 3
 *   del wizard).
 * - POST /api/whatsapp/setup {tenant, phone_number_id?, token?} (owner).
 * - POST /api/whatsapp/register-webhook {tenant, callback_url} (owner) →
 *   resultado de Meta {ok|error, detalle}.
 */

export function useWhatsAppStatus(
  tenant: string,
  pollMs: number | false = false
) {
  return useQuery({
    queryKey: ['whatsapp', 'status', tenant],
    queryFn: async () => {
      const res = await api.get<WhatsAppStatus>('/api/whatsapp/status', {
        params: { tenant },
      })
      return res.data
    },
    refetchInterval: pollMs || undefined,
  })
}

export function useWhatsAppSetup(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: { phoneNumberId?: string; token?: string }) => {
      const res = await api.post('/api/whatsapp/setup', {
        tenant,
        phone_number_id: vars.phoneNumberId || undefined,
        token: vars.token || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', tenant] })
      toast.success('Canal actualizado')
    },
    onError: (error) => {
      toast.error(
        apiErrorDetail(error) ?? 'No se pudo actualizar el canal de WhatsApp'
      )
    },
  })
}

/**
 * Normaliza la respuesta de "resultado Meta {ok|error, detalle}" — el
 * contrato no fija el nombre exacto del campo, así que aceptamos
 * `resultado`/`ok`/`status` y `detalle`/`detail`.
 */
function normalizarResultado(data: unknown): WebhookResult {
  const obj = (data ?? {}) as Record<string, unknown>
  const bruto = obj.resultado ?? obj.ok ?? obj.status
  const detalle =
    (typeof obj.detalle === 'string' && obj.detalle) ||
    (typeof obj.detail === 'string' && obj.detail) ||
    ''
  if (bruto === true || bruto === 'ok' || bruto === 'success') {
    return { ok: true, detalle: detalle || 'Webhook registrado en Meta' }
  }
  return {
    ok: false,
    detalle: detalle || 'Meta rechazó el registro del webhook',
  }
}

export function useRegisterWebhook(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (callbackUrl: string): Promise<WebhookResult> => {
      const res = await api.post('/api/whatsapp/register-webhook', {
        tenant,
        callback_url: callbackUrl,
      })
      return normalizarResultado(res.data)
    },
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', tenant] })
      if (resultado.ok) {
        toast.success('Webhook registrado en Meta', {
          description: resultado.detalle,
        })
      } else {
        toast.error('Meta rechazó el registro', {
          description: resultado.detalle,
        })
      }
    },
    onError: (error) => {
      // El backend puede devolver 4xx/5xx con el detalle de Meta adentro
      toast.error(apiErrorDetail(error) ?? 'No se pudo registrar el webhook', {
        description:
          'Verifica que la URL del túnel sea pública y que el backend esté online.',
      })
    },
  })
}

/** Resultado de POST /api/whatsapp/conectar (secuencia de un botón). */
export type ConectarPaso = { paso: string; ok: boolean; detalle: string }
export type ConectarResultado = {
  ok: boolean
  pasos: ConectarPaso[]
  webhook_url_registrada?: string | null
}

/**
 * Conexión de UN BOTÓN: el backend ejecuta la secuencia completa aprendida
 * el 2026-10-11 (suscripción whatsapp_business_account + campo messages,
 * limpieza de la vieja object=whatsapp, WABA subscribed_apps y verificación).
 * Sin callbackUrl usa el hostname del túnel configurado en el .env del backend.
 */
export function useConectarTodo(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (callbackUrl?: string): Promise<ConectarResultado> => {
      const res = await api.post('/api/whatsapp/conectar', {
        tenant,
        callback_url: callbackUrl || undefined,
      })
      return res.data as ConectarResultado
    },
    onSuccess: (resultado) => {
      void queryClient.invalidateQueries({ queryKey: ['whatsapp', tenant] })
      if (resultado.ok) {
        toast.success('WhatsApp conectado', {
          description:
            'Los 5 pasos en verde: el bot ya recibe y responde mensajes reales.',
        })
      } else {
        toast.error('La conexión quedó incompleta', {
          description: 'Revisa los pasos marcados en rojo.',
        })
      }
    },
    onError: (error) => {
      toast.error(
        apiErrorDetail(error) ?? 'No se pudo ejecutar la conexión completa'
      )
    },
  })
}
