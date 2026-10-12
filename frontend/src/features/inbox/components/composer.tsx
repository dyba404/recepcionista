import { useState } from 'react'
import { Send } from 'lucide-react'
import type { Conversation } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useConversationActions } from '@/hooks/use-conversation-actions'
import { CannedPicker } from './canned-picker'

/**
 * Composer del hilo: textarea (Enter envía, Shift+Enter salta línea) +
 * picker de respuestas rápidas + enviar (POST /messages). Activo solo
 * cuando la conversación está en mano humana — con el bot el backend
 * respondería doble.
 */
export function Composer({ conversation }: { conversation: Conversation }) {
  const { sendMessage } = useConversationActions()
  const [texto, setTexto] = useState('')
  const activo = conversation.estado === 'humano'

  function enviar() {
    const body = texto.trim()
    if (!body || !activo) return
    sendMessage.mutate(
      { id: conversation.id, body },
      {
        // Solo limpiamos cuando el backend aceptó el mensaje
        onSuccess: () => setTexto(''),
      }
    )
  }

  return (
    <div className='border-t p-3'>
      {!activo && (
        <p className='mb-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground'>
          {conversation.estado === 'resuelta'
            ? 'Conversación resuelta — el composer está inactivo.'
            : 'El bot está atendiendo esta conversación. Toma el control (arriba) para responder al cliente.'}
        </p>
      )}
      <div className='flex items-end gap-2'>
        <CannedPicker
          disabled={!activo}
          onPick={(t) => setTexto((prev) => (prev ? `${prev} ${t}` : t))}
        />
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar()
            }
          }}
          placeholder='Escribe un mensaje…'
          aria-label='Mensaje para el cliente'
          rows={1}
          disabled={!activo}
          className='max-h-32 min-h-9 flex-1 resize-none'
        />
        <Button
          size='icon'
          onClick={enviar}
          disabled={
            !activo || !texto.trim() || sendMessage.isPending
          }
          aria-label='Enviar mensaje'
          className='size-9 shrink-0'
        >
          <Send className='size-4' />
        </Button>
      </div>
    </div>
  )
}
