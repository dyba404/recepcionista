import { Badge } from '@/components/ui/badge'
import type { OrderPago } from '@/lib/types'
import { PAGO_LABEL } from '@/lib/order-utils'
import { cn } from '@/lib/utils'

/** pagado* = verde, pendiente_verificar = ámbar, pendiente = roja */
const PAGO_STYLE: Record<OrderPago, string> = {
  pendiente: 'bg-red-600 text-white',
  pendiente_verificar: 'bg-amber-500 text-black',
  pagado_culqi: 'bg-emerald-600 text-white',
  pagado_yape: 'bg-emerald-600 text-white',
  pagado_culqi_real: 'bg-emerald-600 text-white',
}

export function OrderPagoBadge({
  pago,
  className,
}: {
  pago: OrderPago
  className?: string
}) {
  return (
    <Badge className={cn('border-transparent', PAGO_STYLE[pago], className)}>
      {PAGO_LABEL[pago] ?? pago}
    </Badge>
  )
}
