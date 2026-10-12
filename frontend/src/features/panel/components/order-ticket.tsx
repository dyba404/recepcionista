import type { CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { GripVertical, MapPin } from 'lucide-react'
import { OrderPagoBadge } from '@/components/order-pago-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import type { Order, OrderEstado } from '@/lib/types'
import { ESTADO_LABEL, avanceLabel, penFormatter, siguienteEstado } from '@/lib/order-utils'
import { cn } from '@/lib/utils'

interface OrderTicketProps {
  order: Order
  dishNames: Record<string, string>
  onAdvance: (order: Order, target: OrderEstado) => void
  isPending: (id: string) => boolean
}

export function OrderTicket({
  order,
  dishNames,
  onAdvance,
  isPending,
}: OrderTicketProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: order.id,
    data: { estado: order.estado, type: 'ticket' },
    disabled: isPending(order.id),
  })

  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  }

  const target = siguienteEstado(order.estado)

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        'gap-3 rounded-lg p-3 shadow-sm',
        isDragging && 'z-10 opacity-60 shadow-md'
      )}
    >
      <CardHeader className='p-0'>
        <div className='flex items-center gap-1.5'>
          <button
            type='button'
            {...attributes}
            {...listeners}
            aria-label={`Arrastrar pedido ${order.id}`}
            className='cursor-grab touch-none text-muted-foreground active:cursor-grabbing'
          >
            <GripVertical className='size-4' />
          </button>
          <span className='font-mono text-sm font-bold'>{order.id}</span>
          <Badge variant='secondary' className='capitalize'>
            {order.tenant}
          </Badge>
          <OrderPagoBadge pago={order.pago} className='ms-auto' />
        </div>
        <p className='pt-1 text-sm font-semibold'>{order.cliente}</p>
      </CardHeader>

      <ul className='space-y-0.5 text-sm text-muted-foreground'>
        {order.items.map((item) => (
          <li key={item.id} className='tabular-nums'>
            <span className='font-mono font-semibold text-foreground'>
              {item.cant}×
            </span>{' '}
            {dishNames[item.id] ?? item.id}
          </li>
        ))}
      </ul>

      <CardFooter className='flex-col items-stretch gap-2 p-0'>
        <div className='flex items-center justify-between text-sm'>
          <span className='font-semibold tabular-nums'>
            {penFormatter.format(order.total)}
          </span>
          {order.direccion && (
            <span className='flex min-w-0 items-center gap-1 text-xs text-muted-foreground'>
              <MapPin className='size-3 shrink-0' />
              <span className='truncate'>{order.direccion}</span>
            </span>
          )}
        </div>
        {target && (
          <Button
            size='sm'
            variant='outline'
            className='w-full'
            disabled={isPending(order.id)}
            onClick={() => onAdvance(order, target)}
          >
            {avanceLabel(order.estado)} → {ESTADO_LABEL[target]}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
