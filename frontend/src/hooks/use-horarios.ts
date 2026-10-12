import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HorarioDia, HorariosResp } from '@/lib/types'

/**
 * Horarios de atención (contrato horarios-pausa-notif-perfil, A — patrón
 * Chatwoot working hours):
 * - GET /api/horarios?tenant= (Bearer) → 7 filas Lun..Dom + abierto_ahora
 *   + mensaje_estado ("Abierto — cierra a las 22:00"), calculados por el
 *   backend con hora local (America/Lima).
 * - PATCH /api/horarios {tenant, dias:[{dia,activo,apertura,cierre}×7]}
 *   (manage_settings + dueño del tenant) → upsert. La validación de
 *   HH:MM y apertura<cierre se repite en el cliente (inline) para no
 *   esperar el 422.
 *
 * Los errores NO se toastean aquí: la página Horarios los muestra inline
 * (patrón Asistente); el toast de éxito lo dispara el callback de mutate.
 */

/** Etiquetas Lun..Dom — el backend indexa dia 0=Lunes..6=Domingo. */
export const DIAS_SEMANA = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const

/** ¿"HH:MM" válido y apertura anterior al cierre? (comparación lexicográfica) */
export function horarioValido(h: HorarioDia): boolean {
  if (!h.activo) return true // día inactivo no abre/cierra nada
  const re = /^\d{2}:\d{2}$/
  return re.test(h.apertura) && re.test(h.cierre) && h.apertura < h.cierre
}

export function useHorarios(tenant: string) {
  return useQuery({
    queryKey: ['horarios', tenant],
    queryFn: async () => {
      const res = await api.get<HorariosResp>('/api/horarios', {
        params: { tenant },
      })
      return res.data
    },
    staleTime: 30_000,
  })
}

export function useSaveHorarios(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (dias: HorarioDia[]) => {
      const res = await api.patch('/api/horarios', { tenant, dias })
      return res.data
    },
    onSuccess: () => {
      // Refresca tabla + badge de estado (abierto_ahora / mensaje_estado).
      void queryClient.invalidateQueries({ queryKey: ['horarios', tenant] })
    },
  })
}
