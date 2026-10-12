import { cn } from '@/lib/utils'
import type { WsStatus } from '@/hooks/use-orders-ws'

const CONFIG: Record<WsStatus, { label: string; dot: string; text: string }> = {
  'en vivo': { label: 'En vivo', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  conectando: {
    label: 'Conectando…',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
  },
  caido: { label: 'Caído', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
}

/** Badge de conexión WS para el header del panel y de cocina. */
export function LiveBadge({
  status,
  className,
}: {
  status: WsStatus
  className?: string
}) {
  const cfg = CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        cfg.text,
        className
      )}
      title='Conexión WebSocket /ws/orders'
    >
      <span className={cn('size-2 rounded-full', cfg.dot)} aria-hidden />
      {cfg.label}
    </span>
  )
}
