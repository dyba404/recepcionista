import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { Conversation } from '@/lib/types'
import { useCurrentTenant } from '@/hooks/use-modules'

/**
 * Acciones del handoff sobre una conversación (contrato modulos-mvp):
 * takeover | release | resolve | read (sin body), assign {user_id},
 * note {texto}, messages {body}. Cada acción invalida la lista de
 * conversaciones (y el hilo cuando aplica); el WS reconcilia el resto.
 */
export function useConversationActions() {
  const queryClient = useQueryClient()
  const tenant = useCurrentTenant()

  const invalidarConversaciones = () => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }

  const onErrorAccion = (error: unknown) => {
    toast.error(apiErrorDetail(error) ?? 'No se pudo completar la acción')
  }

  const takeover = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/conversations/${id}/takeover`)
      return res.data
    },
    onSuccess: () => {
      invalidarConversaciones()
      toast.success('Atiendes esta conversación — el bot se pausa')
    },
    onError: onErrorAccion,
  })

  const release = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/conversations/${id}/release`)
      return res.data
    },
    onSuccess: () => {
      invalidarConversaciones()
      toast.success('El bot retomó la conversación')
    },
    onError: onErrorAccion,
  })

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/conversations/${id}/resolve`)
      return res.data
    },
    onSuccess: () => {
      invalidarConversaciones()
      toast.success('Conversación resuelta')
    },
    onError: onErrorAccion,
  })

  /** Marcar leída: optimista (unread → 0 al instante, el badge reacciona). */
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/conversations/${id}/read`)
      return res.data
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['conversations', tenant] })
      const previous = queryClient.getQueryData<Conversation[]>([
        'conversations',
        tenant,
      ])
      queryClient.setQueryData<Conversation[]>(['conversations', tenant], (old) =>
        old?.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
      )
      return { previous }
    },
    onError: (_error, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['conversations', tenant], ctx.previous)
      }
    },
    onSettled: () => {
      // El backend también emite conversation.updated: reconcile de todos modos
      invalidarConversaciones()
    },
  })

  const assign = useMutation({
    mutationFn: async (vars: { id: string; userId: string | number }) => {
      const res = await api.post(`/api/conversations/${vars.id}/assign`, {
        user_id: vars.userId,
      })
      return res.data
    },
    onSuccess: () => {
      invalidarConversaciones()
      toast.success('Conversación asignada')
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo asignar')
    },
  })

  const addNote = useMutation({
    mutationFn: async (vars: { id: string; texto: string }) => {
      const res = await api.post(`/api/conversations/${vars.id}/note`, {
        texto: vars.texto,
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      invalidarConversaciones()
      void queryClient.invalidateQueries({ queryKey: ['messages', vars.id] })
      toast.success('Nota interna agregada')
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo guardar la nota')
    },
  })

  const sendMessage = useMutation({
    mutationFn: async (vars: { id: string; body: string }) => {
      const res = await api.post(`/api/conversations/${vars.id}/messages`, {
        body: vars.body,
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', vars.id] })
      invalidarConversaciones()
    },
    onError: (error) => {
      toast.error(apiErrorDetail(error) ?? 'No se pudo enviar el mensaje')
    },
  })

  return {
    takeover,
    release,
    resolve,
    markRead,
    assign,
    addNote,
    sendMessage,
  }
}
