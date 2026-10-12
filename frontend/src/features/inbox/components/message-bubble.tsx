import { Bot, StickyNote, UserRound } from 'lucide-react'
import type { Message, MessageRole } from '@/lib/types'
import { formatHora } from '@/lib/datetime'
import { cn } from '@/lib/utils'

/**
 * Burbuja estilo WhatsApp: cliente a la izquierda en papel (muted), bot y
 * humano a la derecha en tinte tomate (primary), notas internas en
 * cursiva con estilo distinto (dashed, ámbar).
 */
const ESTILO_ROL: Record<string, string> = {
  cliente:
    'self-start rounded-2xl rounded-bl-sm border bg-muted text-foreground',
  bot: 'self-end rounded-2xl rounded-br-sm bg-primary/10 text-foreground',
  humano:
    'self-end rounded-2xl rounded-br-sm bg-primary/20 text-foreground',
}

const ETIQUETA_ROL: Partial<Record<MessageRole, string>> = {
  bot: 'Bot',
  humano: 'Equipo',
}

export function MessageBubble({
  message,
}: {
  message: Message
}) {
  const esNota = message.role === 'nota'

  if (esNota) {
    return (
      <div
        className='mx-auto w-full max-w-md rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2'
        role='note'
      >
        <div className='flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400'>
          <StickyNote className='size-3' />
          Nota interna
        </div>
        <p className='mt-0.5 text-xs italic text-amber-800 dark:text-amber-200'>
          {message.body}
        </p>
        <div className='mt-0.5 text-end text-[10px] text-muted-foreground'>
          {formatHora(message.created_at)}
        </div>
      </div>
    )
  }

  const estilo = ESTILO_ROL[message.role] ?? ESTILO_ROL.cliente!
  const etiqueta = ETIQUETA_ROL[message.role]
  const Icono = message.role === 'bot' ? Bot : UserRound

  return (
    <div className={cn('flex max-w-[85%] flex-col sm:max-w-[70%]', estilo)}>
      {etiqueta && (
        <span className='flex items-center gap-1 px-3 pt-2 text-[10px] font-medium text-muted-foreground'>
          <Icono className='size-2.5' />
          {etiqueta}
        </span>
      )}
      <p className='whitespace-pre-wrap break-words px-3 py-1.5 text-sm leading-relaxed'>
        {message.body}
      </p>
      <span className='px-3 pb-1.5 text-end text-[10px] text-muted-foreground'>
        {formatHora(message.created_at)}
      </span>
    </div>
  )
}
