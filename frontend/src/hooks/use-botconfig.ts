import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
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
 * Los errores NO se toastean aquí: la página Asistente los muestra verbatim
 * (inline, como el rechazo de Culqi en Pagos). El éxito invalida
 * ['botconfig', tenant]; el toast lo dispara la página con el callback de
 * mutate.
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
    }) => {
      const res = await api.put('/api/botconfig', {
        tenant,
        nombre_bot: vars.nombre_bot,
        saludo: vars.saludo,
        tono: vars.tono,
        instrucciones_extra: vars.instrucciones_extra,
      })
      return res.data
    },
    onSuccess: () => {
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
