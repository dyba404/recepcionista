import { Bot, CheckCheck, UserRound } from 'lucide-react'
import type { Conversation } from '@/lib/types'
import { formatHoraRelativa } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { iniciales } from '../inbox-utils'

const ESTADO_ICONO: Record<string, typeof Bot> = {
  bot: Bot,
  humano: UserRound,
  resuelta: CheckCheck,
}

/**
 * Item de conversación de la lista (patrón Chatwoot): avatar de
 * iniciales, nombre, último mensaje, hora relativa y punto tomate de no
 * leído.
 */
export function ConversationItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: Conversation
  active: boolean
  onSelect: (id: string) => void
}) {
  const IconoEstado = ESTADO_ICONO[conversation.estado]

  return (
    <button
      type='button'
      onClick={() => onSelect(conversation.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent/60',
        active && 'bg-accent'
      )}
    >
      <Avatar className='size-9 shrink-0'>
        <AvatarFallback className='bg-primary/10 text-xs font-semibold text-primary'>
          {iniciales(conversation.cliente)}
        </AvatarFallback>
      </Avatar>

      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-1.5'>
          {IconoEstado && (
            <IconoEstado className='size-3 shrink-0 text-muted-foreground' />
          )}
          <span className='truncate text-sm font-medium'>
            {conversation.cliente || conversation.wa_id}
          </span>
          <span className='ms-auto shrink-0 text-[11px] text-muted-foreground'>
            {formatHoraRelativa(conversation.last_message_at)}
          </span>
        </span>
        <span className='mt-0.5 flex items-center gap-2'>
          <span className='truncate text-xs text-muted-foreground'>
            {conversation.last_body || '—'}
          </span>
          {conversation.unread > 0 && (
            <span
              className='ms-auto size-2.5 shrink-0 rounded-full bg-primary'
              role='status'
              aria-label={`${conversation.unread} sin leer`}
            />
          )}
        </span>
      </span>
    </button>
  )
}
