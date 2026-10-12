import { Flame, MapPin } from 'lucide-react'
import { OrderPagoBadge } from '@/components/order-pago-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import type { Order, OrderEstado } from '@/lib/types'
import { ESTADO_LABEL, siguienteEstado } from '@/lib/order-utils'
import { cn } from '@/lib/utils'

interface KdsTicketProps {
  order: Order
  dishNames: Record<string, string>
  tenantNombre: string
  onAdvance: (order: Order, target: OrderEstado) => void
  isPending: (id: string) => boolean
}

/**
 * Ticket del KDS: tipografía grande (cliente 1.5rem+, cantidades mono),
 * un solo botón de avance con target ≥56px.
 */
export function KdsTicket({
  order,
  dishNames,
  tenantNombre,
  onAdvance,
  isPending,
}: KdsTicketProps) {
  const target = siguienteEstado(order.estado)

  return (
    <Card
      className={cn(
        'gap-4 rounded-xl border-2 p-5 shadow-sm transition-colors',
        order.estado === 'cocina' && 'border-primary/40'
      )}
    >
      <CardHeader className='p-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-mono text-lg font-bold'>{order.id}</span>
          <Badge variant='outline'>{tenantNombre}</Badge>
          <Badge variant='secondary'>{ESTADO_LABEL[order.estado]}</Badge>
          <OrderPagoBadge pago={order.pago} className='ms-auto' />
        </div>
        {/* display font: nombre del cliente en grande */}
        <p className='pt-2 text-3xl font-black uppercase tracking-tight'>
          {order.cliente}
        </p>
      </CardHeader>

      <ul className='space-y-1 text-xl font-semibold'>
        {order.items.map((item) => (
          <li key={item.id} className='tabular-nums'>
            <span className='font-mono text-2xl font-bold'>{item.cant}×</span>{' '}
            {dishNames[item.id] ?? item.id}
          </li>
        ))}
      </ul>

      {order.direccion && (
        <p className='flex items-center gap-1.5 text-base text-muted-foreground'>
          <MapPin className='size-4 shrink-0' /> {order.direccion}
        </p>
      )}

      <CardFooter className='p-0'>
        {target && (
          <Button
            size='lg'
            className='h-14 w-full text-lg font-bold'
            variant={order.estado === 'confirmado' ? 'default' : 'outline'}
            disabled={isPending(order.id)}
            onClick={() => onAdvance(order, target)}
          >
            {order.estado === 'confirmado' ? (
              <>
                <Flame className='size-5' /> En cocina
              </>
            ) : (
              <>Listo ✓</>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
