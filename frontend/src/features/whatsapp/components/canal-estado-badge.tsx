import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WhatsAppEstado } from '@/lib/types'

/**
 * Badge del estado del canal WhatsApp (contrato modulos-mvp):
 * desconectado rojo / conectado verde / pausado ámbar.
 */
const CONFIG: Record<
  string,
  { label: string; dot: string; text: string }
> = {
  desconectado: {
    label: 'Desconectado',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400',
  },
  conectado: {
    label: 'Conectado',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
  pausado: {
    label: 'Pausado',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
  },
}

export function CanalEstadoBadge({
  estado,
  className,
}: {
  estado: WhatsAppEstado | undefined
  className?: string
}) {
  if (!estado) {
    return (
      <Badge variant='outline' className={cn('text-muted-foreground', className)}>
        Sin estado
      </Badge>
    )
  }

  const cfg = CONFIG[estado]
  if (!cfg) {
    return (
      <Badge variant='outline' className={cn('text-muted-foreground', className)}>
        {estado}
      </Badge>
    )
  }

  return (
    <Badge
      variant='outline'
      className={cn('gap-1.5 border-transparent', cfg.text, className)}
    >
      <span className={cn('size-2 rounded-full', cfg.dot)} aria-hidden />
      {cfg.label}
    </Badge>
  )
}
