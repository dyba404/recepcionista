import type { PaymentsEstado } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * Badge del estado de la cuenta de la pasarela (contrato pasarela-culqi):
 * desconectada roja / conectada verde. Patrón del canal-estado-badge de
 * WhatsApp, en femenino (la cuenta/la pasarela).
 */
const CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  desconectada: {
    label: 'Desconectada',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400',
  },
  conectada: {
    label: 'Conectada',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
}

export function CuentaEstadoBadge({
  estado,
  className,
}: {
  estado: PaymentsEstado | undefined
  className?: string
}) {
  if (!estado) {
    return (
      <Badge
        variant='outline'
        className={cn('text-muted-foreground', className)}
      >
        Sin estado
      </Badge>
    )
  }

  const cfg = CONFIG[estado]
  if (!cfg) {
    return (
      <Badge
        variant='outline'
        className={cn('text-muted-foreground', className)}
      >
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
