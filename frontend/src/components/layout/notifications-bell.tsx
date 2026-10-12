import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  ClipboardList,
  MessageCircle,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatHoraRelativa } from '@/lib/datetime'
import type { NotificationItem, NotificationTipo } from '@/lib/types'
import { useNotificationsStore } from '@/stores/notifications-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

/**
 * Campana de notificaciones (contrato horarios-pausa-notif-perfil, C).
 * Se monta en el header de cada página (desktop + móvil) y como ítem del
 * menú móvil del sidebar — es SOLO un consumidor del store en memoria que
 * llena use-notifications (montado una vez en el AuthenticatedLayout);
 * no abre sockets ni queries propias.
 *
 * Al abrirse marca todo como leído (badge a 0); click en un ítem navega
 * a /panel (pedidos/pagos/fraude) o /inbox (mensajes) y cierra.
 */

/** Icono y color por tipo de notificación (contrato sección C). */
const TIPO_META: Record<
  NotificationTipo,
  { icon: LucideIcon; className: string }
> = {
  pedido: {
    icon: ClipboardList,
    className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  pago: {
    icon: BadgeCheck,
    className:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  fraude: {
    icon: ShieldAlert,
    className: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  mensaje: {
    icon: MessageCircle,
    className: 'bg-primary/10 text-primary',
  },
  estado: {
    icon: ArrowRight,
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className='absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums'>
      {count > 9 ? '9+' : count}
    </span>
  )
}

function NotifIcon({ count }: { count: number }) {
  return (
    <span className='relative'>
      <Bell className='size-4' />
      <UnreadBadge count={count} />
    </span>
  )
}

function NotificationRow({
  item,
  onNavigate,
}: {
  item: NotificationItem
  onNavigate: (ruta: string) => void
}) {
  const meta = TIPO_META[item.tipo]
  const Icon = meta.icon
  return (
    <button
      type='button'
      onClick={() => onNavigate(item.ruta)}
      className='flex w-full items-start gap-3 rounded-md px-2 py-2 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
    >
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          meta.className
        )}
      >
        <Icon className='size-4' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm'>{item.texto}</span>
        <span className='block text-xs text-muted-foreground'>
          {formatHoraRelativa(item.createdAt)}
        </span>
      </span>
    </button>
  )
}

/** Lista compartida por la campana del header y la del menú móvil. */
function NotificationsList({
  onNavigate,
}: {
  onNavigate: (ruta: string) => void
}) {
  const items = useNotificationsStore((s) => s.items).slice(0, 20)

  return (
    <div className='max-h-80 overflow-y-auto p-1'>
      {items.length === 0 ? (
        <div className='flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground'>
          <Bell className='size-5 opacity-50' />
          Sin notificaciones todavía.
          <span className='text-xs'>
            Los pedidos, pagos y mensajes nuevos aparecen aquí.
          </span>
        </div>
      ) : (
        items.map((item) => (
          <NotificationRow key={item.id} item={item} onNavigate={onNavigate} />
        ))
      )}
    </div>
  )
}

export function NotificationsBell({
  variant = 'header',
}: {
  /** header: botón icono; menu: ítem del menú móvil del sidebar. */
  variant?: 'header' | 'menu'
}) {
  const [open, setOpen] = useState(false)
  /** No leídos capturados al abrir (markAllRead los pone a 0 en el acto). */
  const [unreadAlAbrir, setUnreadAlAbrir] = useState(0)
  const router = useRouter()
  const unread = useNotificationsStore((s) => s.unreadCount)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)

  function onOpenChange(next: boolean) {
    if (next) {
      // "Marcar leídas" al abrir la campana (contrato C).
      setUnreadAlAbrir(unread)
      markAllRead()
    }
    setOpen(next)
  }

  function onNavigate(ruta: string) {
    setOpen(false)
    void router.navigate({ to: ruta })
  }

  const content = (
    <DropdownMenuContent
      align='end'
      side={variant === 'menu' ? 'bottom' : undefined}
      className='w-80'
    >
      <DropdownMenuLabel className='flex items-center justify-between gap-2'>
        <span>Notificaciones</span>
        {unreadAlAbrir > 0 && (
          <span className='text-xs font-normal text-muted-foreground'>
            {unreadAlAbrir} sin leer
          </span>
        )}
      </DropdownMenuLabel>
      <DropdownMenuSeparator className='my-1' />
      <NotificationsList onNavigate={onNavigate} />
    </DropdownMenuContent>
  )

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        {variant === 'menu' ? (
          <SidebarMenuButton tooltip='Notificaciones'>
            <NotifIcon count={unread} />
            <span>Notificaciones</span>
          </SidebarMenuButton>
        ) : (
          <Button
            variant='ghost'
            size='icon'
            className='relative h-8 w-8'
            aria-label='Notificaciones'
          >
            <NotifIcon count={unread} />
          </Button>
        )}
      </DropdownMenuTrigger>
      {content}
    </DropdownMenu>
  )
}

/** Ítem "Notificaciones" para el menú móvil del sidebar (mismo panel). */
export function NotificationsBellMenuItem() {
  return (
    <SidebarMenuItem>
      <NotificationsBell variant='menu' />
    </SidebarMenuItem>
  )
}
