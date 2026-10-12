import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  Hand,
  MessagesSquare,
  RefreshCw,
  StickyNote,
  UserRound,
} from 'lucide-react'
import type { Conversation } from '@/lib/types'
import { apiErrorDetail } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { etiquetaDia } from '@/lib/datetime'
import { useConversationActions } from '@/hooks/use-conversation-actions'
import { useMessages } from '@/hooks/use-conversations'
import {
  CONV_ESTADO_LABEL,
  CONV_ESTADO_STYLE,
  iniciales,
  porAntiguo,
} from '../inbox-utils'
import { Composer } from './composer'
import { MessageBubble } from './message-bubble'

export type StaffOption = { id: string; nombre: string; email?: string }

/**
 * Panel derecho del inbox: hilo estilo WhatsApp con header de handoff
 * (tomar el control / devolver al bot / resolver / asignar / notas) y
 * composer activo solo en estado humano. Marca leída al abrir.
 */
export function Thread({
  conversation,
  staffOptions,
  onBack,
  className,
}: {
  conversation: Conversation
  staffOptions: StaffOption[]
  onBack?: () => void
  className?: string
}) {
  const actions = useConversationActions()
  const messagesQuery = useMessages(conversation.id)
  const [notaAbierta, setNotaTexto] = useState('')
  const listaRef = useRef<HTMLDivElement>(null)
  const leidasRef = useRef<Set<string>>(new Set())

  // Marcar leída al abrir la conversación (POST /read), una vez por id
  useEffect(() => {
    if (conversation.unread > 0 && !leidasRef.current.has(conversation.id)) {
      leidasRef.current.add(conversation.id)
      actions.markRead.mutate(conversation.id)
    }
  }, [conversation.id, conversation.unread, actions])

  const mensajes = useMemo(
    () => [...(messagesQuery.data ?? [])].sort(porAntiguo),
    [messagesQuery.data]
  )

  // Auto-scroll al fondo al abrir el hilo y con cada mensaje nuevo
  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation.id, mensajes.length])

  const esBot = conversation.estado === 'bot'
  const esHumano = conversation.estado === 'humano'

  return (
    <div
      className={cn(
        'min-h-0 flex-col overflow-hidden rounded-lg border bg-card',
        className
      )}
    >
      {/* ===== Header del hilo ===== */}
      <div className='flex items-center gap-2.5 border-b p-3'>
        {onBack && (
          <Button
            variant='ghost'
            size='icon'
            className='size-8 shrink-0 lg:hidden'
            aria-label='Volver a la lista'
            onClick={onBack}
          >
            <ChevronLeft className='size-4' />
          </Button>
        )}

        <Avatar className='size-9 shrink-0'>
          <AvatarFallback className='bg-primary/10 text-xs font-semibold text-primary'>
            {iniciales(conversation.cliente)}
          </AvatarFallback>
        </Avatar>

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <span className='truncate text-sm font-semibold'>
              {conversation.cliente || conversation.wa_id}
            </span>
            <Badge variant='outline' className='shrink-0 text-[10px] capitalize'>
              {conversation.canal}
            </Badge>
          </div>
          <div className='mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground'>
            <span
              className={cn(
                'rounded-full px-1.5 py-px font-medium',
                CONV_ESTADO_STYLE[conversation.estado] ??
                  'bg-muted text-muted-foreground'
              )}
            >
              {CONV_ESTADO_LABEL[conversation.estado] ?? conversation.estado}
            </span>
            <span className='flex items-center gap-1'>
              <UserRound className='size-3' />
              {conversation.assigned_nombre ?? 'Sin asignar'}
            </span>
            <span className='font-mono'>{conversation.wa_id}</span>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          {esBot && (
            <Button
              size='sm'
              className='gap-1.5'
              disabled={actions.takeover.isPending}
              onClick={() => actions.takeover.mutate(conversation.id)}
            >
              <Hand className='size-3.5' /> Tomar el control
            </Button>
          )}
          {esHumano && (
            <>
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5'
                disabled={actions.release.isPending}
                onClick={() => actions.release.mutate(conversation.id)}
              >
                <Bot className='size-3.5' /> Devolver al bot
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5'
                disabled={actions.resolve.isPending}
                onClick={() => actions.resolve.mutate(conversation.id)}
              >
                <CheckCheck className='size-3.5' /> Resolver
              </Button>
            </>
          )}

          {/* Asignar a staff */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='gap-1'
                aria-label='Asignar conversación'
              >
                <UserRound className='size-3.5' />
                <span className='hidden sm:inline'>Asignar</span>
                <ChevronDown className='size-3.5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>Asignar a</DropdownMenuLabel>
              {staffOptions.length === 0 ? (
                <DropdownMenuItem disabled>
                  No hay equipo disponible aún
                </DropdownMenuItem>
              ) : (
                staffOptions.map((staff) => (
                  <DropdownMenuItem
                    key={staff.id}
                    disabled={actions.assign.isPending}
                    onClick={() =>
                      actions.assign.mutate({
                        id: conversation.id,
                        userId: staff.id,
                      })
                    }
                  >
                    <UserRound className='size-3.5' />
                    <span className='max-w-40 truncate'>{staff.nombre}</span>
                    {staff.email && staff.email !== staff.nombre && (
                      <span className='max-w-40 truncate text-xs text-muted-foreground'>
                        {staff.email}
                      </span>
                    )}
                    {String(conversation.assigned_to ?? '') === staff.id && (
                      <Check className='ms-auto size-3.5' />
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Nota interna */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label='Agregar nota interna'
              >
                <StickyNote className='size-4' />
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-80'>
              <div className='space-y-2'>
                <div className='text-sm font-semibold'>Nota interna</div>
                <p className='text-xs text-muted-foreground'>
                  Solo la ve tu equipo — nunca se envía al cliente.
                </p>
                <Textarea
                  value={notaAbierta}
                  onChange={(e) => setNotaTexto(e.target.value)}
                  placeholder='Ej. cliente pide sin cilantro…'
                  className='min-h-16 text-sm'
                />
                <Button
                  size='sm'
                  className='w-full gap-1.5'
                  disabled={
                    !notaAbierta.trim() || actions.addNote.isPending
                  }
                  onClick={() =>
                    actions.addNote.mutate(
                      { id: conversation.id, texto: notaAbierta.trim() },
                      {
                        onSuccess: () => setNotaTexto(''),
                      }
                    )
                  }
                >
                  <StickyNote className='size-3.5' /> Guardar nota
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* ===== Hilo de mensajes ===== */}
      <div
        ref={listaRef}
        className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4'
        aria-live='polite'
      >
        {messagesQuery.isPending ? (
          <div className='flex flex-1 flex-col justify-end gap-2'>
            <Skeleton className='ms-auto h-12 w-2/3 rounded-2xl sm:w-2/5' />
            <Skeleton className='me-auto h-12 w-2/3 rounded-2xl sm:w-2/5' />
            <Skeleton className='ms-auto h-12 w-1/2 rounded-2xl sm:w-1/3' />
          </div>
        ) : messagesQuery.isError ? (
          <Alert variant='destructive' className='m-auto max-w-sm'>
            <AlertTitle>No se pudo cargar el hilo</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-2'>
              <span>{apiErrorDetail(messagesQuery.error) ?? messagesQuery.error.message}</span>
              <Button
                size='sm'
                variant='outline'
                className='gap-1.5'
                onClick={() => void messagesQuery.refetch()}
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : mensajes.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-2 text-center'>
            <MessagesSquare className='size-8 text-muted-foreground/50' />
            <p className='text-sm text-muted-foreground'>
              Sin mensajes todavía — cuando el cliente escriba, aparece
              aquí al instante.
            </p>
          </div>
        ) : (
          mensajes.map((m, i) => {
            const anterior = mensajes[i - 1]
            const cambiaDia =
              !anterior ||
              etiquetaDia(anterior.created_at) !== etiquetaDia(m.created_at)
            return (
              <Fragment key={m.id}>
                {cambiaDia && (
                  <div className='my-1 text-center text-[11px] font-medium text-muted-foreground'>
                    {etiquetaDia(m.created_at)}
                  </div>
                )}
                <MessageBubble message={m} />
              </Fragment>
            )
          })
        )}
      </div>

      <Composer conversation={conversation} />
    </div>
  )
}
