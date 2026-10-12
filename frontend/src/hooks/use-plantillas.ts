import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { WATemplate } from '@/lib/types'

/**
 * Plantillas WhatsApp (contrato endurecer-local, sección D):
 * - GET /api/whatsapp/plantillas?tenant= (Bearer): merge de las del espejo
 *   local con las de Meta (best effort — si Graph falla, solo locales).
 * - POST /api/whatsapp/plantillas {tenant, nombre, categoria, lenguaje,
 *   cuerpo} (manage_settings): crea en Meta y guarda el espejo con el
 *   estado según la respuesta (en el sandbox puede quedar PENDING_APPROVAL
 *   — se muestra tal cual).
 * - POST /api/whatsapp/plantillas/enviar {tenant, nombre, lenguaje,
 *   telefono?} (manage_settings): "Enviar prueba" al número de test de
 *   Meta; el error de Meta llega verbatim en `detail`.
 *
 * Ninguna mutación toastea aquí: la página muestra el resultado por fila
 * (toast del envío) o inline en el dialog (error verbatim del POST), igual
 * que useKnowledge con EntradaDialog.
 */

export function usePlantillas(tenant: string) {
  return useQuery({
    queryKey: ['plantillas', tenant],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<WATemplate[]>('/api/whatsapp/plantillas', {
        params: { tenant },
      })
      return res.data
    },
  })
}

export function useCreatePlantilla(tenant: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vars: {
      nombre: string
      categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
      lenguaje: 'es' | 'en'
      cuerpo: string
    }) => {
      const res = await api.post<WATemplate>('/api/whatsapp/plantillas', {
        tenant,
        nombre: vars.nombre,
        categoria: vars.categoria,
        lenguaje: vars.lenguaje,
        cuerpo: vars.cuerpo,
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plantillas', tenant] })
    },
  })
}

/**
 * Resultado de "Enviar prueba" — el contrato no fija la forma del ok, así
 * que se lee suelto: `ok:false` (o `detalle` de un 4xx) se muestra verbatim.
 */
export interface EnviarPruebaResult {
  ok?: boolean
  detalle?: string
  [key: string]: unknown
}

export function useEnviarPruebaPlantilla(tenant: string) {
  return useMutation({
    mutationFn: async (vars: {
      nombre: string
      lenguaje: string
      telefono?: string
    }) => {
      const res = await api.post<EnviarPruebaResult>(
        '/api/whatsapp/plantillas/enviar',
        {
          tenant,
          nombre: vars.nombre,
          lenguaje: vars.lenguaje,
          ...(vars.telefono ? { telefono: vars.telefono } : {}),
        }
      )
      return res.data
    },
  })
}
