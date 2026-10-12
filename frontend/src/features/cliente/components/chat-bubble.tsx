import { Bot } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { formatHora } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { ChatMarkdown } from './chat-markdown'

/** Mensaje del simulador (solo UI; el backend no persiste el demo). */
export interface ChatMsg {
  id: number
  role: 'cliente' | 'bot'
  text?: string
  /** Foto del plato ("/static/img/platos/f1.jpg") — burbuja aparte, antes del texto. */
  foto?: string
  /** ISO del momento en que se envió/recibió. */
  ts: string
  /** Id del pedido ("#107"): renderiza el link "Míralo en el Panel". */
  panel?: string
}

/**
 * Burbujas del simulador: cliente a la derecha con tinte tomate (como el
 * "me" de WhatsApp), bot a la izquierda en papel crema. La hora va
 * discreta al pie de cada burbuja.
 */
export function ChatBubble({
  message,
  tenant,
}: {
  message: ChatMsg
  tenant: string
}) {
  const esCliente = message.role === 'cliente'

  return (
    <div
      className={cn(
        'flex max-w-[88%] flex-col sm:max-w-[78%]',
        esCliente
          ? 'self-end rounded-2xl rounded-br-sm border border-primary/25 bg-primary/15 px-3 py-2'
          : 'self-start rounded-2xl rounded-bl-sm border bg-muted/60 px-3 py-2'
      )}
    >
      {message.foto ? (
        <img
          src={message.foto}
          alt='Foto del plato'
          loading='lazy'
          className='mb-1 max-w-full rounded-lg border'
        />
      ) : null}
      {message.text ? <ChatMarkdown text={message.text} /> : null}
      {message.panel ? (
        <Link
          to='/panel'
          search={{ tenant }}
          className='mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline'
        >
          Míralo en el Panel →
        </Link>
      ) : null}
      <span className='mt-0.5 self-end font-mono text-[10px] text-muted-foreground'>
        {formatHora(message.ts)}
      </span>
    </div>
  )
}

/** Indicador "escribiendo…" — el LLM puede tardar 10-20 s, es la clave del realismo. */
export function TypingBubble() {
  return (
    <div className='flex items-center gap-2 self-start rounded-2xl rounded-bl-sm border bg-muted/60 px-3 py-2.5'>
      <span className='flex items-center gap-1'>
        <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]' />
        <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]' />
        <span className='size-1.5 animate-bounce rounded-full bg-muted-foreground/70' />
      </span>
      <span className='flex items-center gap-1 text-xs text-muted-foreground'>
        <Bot className='size-3' /> escribiendo…
      </span>
    </div>
  )
}
