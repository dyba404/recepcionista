import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { BotConfig, BotTono } from '@/lib/types'

/**
 * Configuración del bot (contrato carta-inventario-bot, sección C):
 * - GET /api/botconfig?tenant= (Bearer) → {nombre_bot, saludo, tono,
 *   instrucciones_extra}. El bot usa el saludo en el menú, el nombre en su
 *   identidad y el tono/instrucciones como línea extra del prompt.
 * - PUT /api/botconfig {tenant, nombre_bot, saludo, tono,
 *   instrucciones_extra} (manage_settings; 422 si las instrucciones pasan
 *   de 800 chars).
 *
 * Contrato horarios-pausa-notif-perfil (B): el bot gana `pausado` —
 * PATCH /api/botconfig {tenant, pausado} con actualización optimista +
 * rollback (usePauseBot); el PUT de personalidad lo reenvía para no
 * pisar la pausa al guardar.
 *
 * Los errores NO se toastean aquí (salvo en usePauseBot, que sí es un
 * toggle instantáneo tipo módulos): la página Asistente los muestra
 * verbatim inline, como el rechazo de Culqi en Pagos. El éxito invalida
 * ['botconfig', tenant]; el toast lo dispara la página con el callback
 * de mutate.
 */

export function useBotConfig(tenant: string) {
  return useQuery({
    queryKey: ['botconfig', tenant],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<BotConfig>('/api/botconfig', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useSaveBotConfig(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      nombre_bot: string
      saludo: string
      tono: BotTono
      instrucciones_extra: string
      /** Se reenvía para que el PUT completo no revierta la pausa (B). */
      pausado?: boolean
    }) => {
      const res = await api.put('/api/botconfig', {
        tenant,
        nombre_bot: vars.nombre_bot,
        saludo: vars.saludo,
        tono: vars.tono,
        instrucciones_extra: vars.instrucciones_extra,
        pausado: vars.pausado ?? false,
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['botconfig', tenant] })
    },
  })
}

/**
 * Pausa/reanuda el bot (contrato horarios-pausa-notif-perfil, B —
 * auto-responder out-of-office): PATCH /api/botconfig {tenant, pausado}.
 * Toggle optimista sobre ['botconfig', tenant] con rollback visual, como
 * useToggleModule: si el backend rechaza, el switch vuelve y el toast
 * lleva el `detail` real.
 */
export function usePauseBot(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (pausado: boolean) => {
      const res = await api.patch('/api/botconfig', { tenant, pausado })
      return res.data
    },
    onMutate: async (pausado) => {
      await queryClient.cancelQueries({ queryKey: ['botconfig', tenant] })
      const previous = queryClient.getQueryData<BotConfig>([
        'botconfig',
        tenant,
      ])
      queryClient.setQueryData<BotConfig>(['botconfig', tenant], (old) =>
        old ? { ...old, pausado } : old
      )
      return { previous }
    },
    onError: (error, _pausado, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['botconfig', tenant], ctx.previous)
      }
      toast.error(
        apiErrorDetail(error) ?? 'No se pudo cambiar el estado del asistente',
        { description: 'El bot queda tal como estaba.' }
      )
    },
    onSuccess: (_data, pausado) => {
      toast.success(pausado ? 'Asistente pausado' : 'Asistente activo', {
        description: pausado
          ? 'El bot no responde; los mensajes caen al Inbox y el equipo contesta.'
          : 'El bot vuelve a atender el chat de cliente.',
      })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['botconfig', tenant] })
    },
  })
}

/** ¿Es uno de los tonos del contrato? (para hidratar el form sin sorpresas) */
export function esTonoValido(
  tono: string
): tono is 'cercano' | 'formal' | 'divertido' {
  return tono === 'cercano' || tono === 'formal' || tono === 'divertido'
}
