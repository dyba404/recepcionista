import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { OrderEstado } from '@/lib/types'
import { ESTADO_LABEL } from '@/lib/order-utils'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  estado: OrderEstado
  orders: { id: string }[]
  children: ReactNode
}

export function KanbanColumn({ estado, orders, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${estado}`,
    data: { estado, type: 'column' },
  })

  return (
    <Card className='flex w-full shrink-0 flex-col gap-2 p-3 md:w-64 xl:w-auto'>
      <div className='flex items-center justify-between px-1'>
        <h3 className='text-sm font-semibold tracking-tight'>
          {ESTADO_LABEL[estado]}
        </h3>
        <Badge variant='secondary'>{orders.length}</Badge>
      </div>
      <SortableContext
        items={orders.map((o) => o.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-28 flex-1 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
            isOver && 'bg-primary/10 ring-1 ring-primary/40'
          )}
        >
          {children}
        </div>
      </SortableContext>
    </Card>
  )
}
