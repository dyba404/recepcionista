import { ShoppingCart, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { penFormatter } from '@/lib/order-utils'
import type { ChatCartItem } from '@/lib/types'

/**
 * Carrito visible bajo el header del teléfono: ítems + total del último
 * response.cart (más el delivery del local) y botón para limpiarlo.
 */
export function CartChip({
  cart,
  delivery,
  onLimpiar,
}: {
  cart: ChatCartItem[]
  delivery: number
  onLimpiar: () => void
}) {
  const items = cart.reduce((s, i) => s + i.cant, 0)
  const total = cart.reduce((s, i) => s + i.precio * i.cant, 0)
  const detalle = cart.map((i) => `${i.cant}× ${i.nombre}`).join(', ')

  return (
    <div className='flex items-center gap-2 border-b bg-primary/5 px-3 py-1.5'>
      <Badge
        variant='outline'
        className='gap-1.5 border-primary/30 bg-primary/10 text-primary'
        title={detalle}
      >
        <ShoppingCart className='size-3' />
        <span className='tabular-nums'>
          {items} ítems · {penFormatter.format(total)}
        </span>
        <span className='font-normal text-primary/70'>
          + delivery {penFormatter.format(delivery)}
        </span>
      </Badge>
      <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
        {detalle}
      </span>
      <Button
        variant='ghost'
        size='sm'
        className='h-7 gap-1 px-2 text-xs text-muted-foreground'
        onClick={onLimpiar}
      >
        <X className='size-3' /> Limpiar
      </Button>
    </div>
  )
}
