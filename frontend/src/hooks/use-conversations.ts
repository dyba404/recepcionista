import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Conversation, Message } from '@/lib/types'
import { MODULE_KEYS, useCurrentTenant, useModules } from '@/hooks/use-modules'

/**
 * Inbox (patrón Chatwoot): una sola query canónica con TODAS las
 * conversaciones del tenant — filtros (estado, "solo mías", búsqueda) y
 * contadores se derivan en el cliente, y el badge de no leídos del
 * sidebar sale de la misma caché. El WS invalida el prefijo
 * ['conversations'] con conversation.updated / message.created.
 */
export function useConversations() {
  const tenant = useCurrentTenant()
  const inboxHabilitado = useModules().isEnabled(MODULE_KEYS.INBOX)

  return useQuery({
    queryKey: ['conversations', tenant],
    queryFn: async () => {
      const res = await api.get<Conversation[]>('/api/conversations', {
        params: { tenant },
      })
      return res.data
    },
    enabled: inboxHabilitado,
  })
}

/** Suma de `unread` de todas las conversaciones — badge vivo del sidebar. */
export function useUnreadTotal(): number {
  const { data } = useConversations()
  return (data ?? []).reduce((acc, c) => acc + (c.unread ?? 0), 0)
}

/** Hilo de mensajes de una conversación. `null` = ninguna abierta. */
export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['messages', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const res = await api.get<Message[]>(
        `/api/conversations/${conversationId}/messages`
      )
      return res.data
    },
  })
}
