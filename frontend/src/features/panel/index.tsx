import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { LiveBadge } from '@/components/live-badge'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { csvErrorDetail, descargarCsv } from '@/lib/csv-download'
import { useAdvanceOrder } from '@/hooks/use-advance-order'
import { useDemoReset } from '@/hooks/use-demo-reset'
import { useDishNames } from '@/hooks/use-dish-names'
import { useOrders } from '@/hooks/use-orders'
import { useOrdersWs } from '@/hooks/use-orders-ws'
import {
  ORDER_ESTADOS,
  type Order,
  type OrderEstado,
} from '@/lib/types'
import {
  ESTADO_LABEL,
  esAvanceValido,
} from '@/lib/order-utils'
import { KanbanColumn } from './components/kanban-column'
import { OrderTicket } from './components/order-ticket'

const TENANT_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'faro', label: 'Faro' },
  { value: 'brasa', label: 'Brasa' },
  { value: 'juana', label: 'Juana' },
] as const

const routeApi = getRouteApi('/_authenticated/panel/')

export function Panel() {
  const { tenant: tenantParam } = routeApi.useSearch()
  const tenant = tenantParam ?? 'todos'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    data: orders,
    isPending,
    isError,
    error,
    refetch,
  } = useOrders(tenant)
  const wsStatus = useOrdersWs()
  const { advance, isPending: isAdvancing } = useAdvanceOrder(tenant)
  const dishNames = useDishNames()
  const demoReset = useDemoReset()

  // Exportar CSV (contrato endurecer-local): GET /api/reports/pedidos.csv
  // con el filtro de local actual (sin filtro = todos, como /api/orders).
  const [descargandoCsv, setDescargandoCsv] = useState(false)

  async function exportarCsv() {
    setDescargandoCsv(true)
    try {
      await descargarCsv(
        '/api/reports/pedidos.csv',
        tenant === 'todos' ? {} : { tenant },
        `pedidos-${tenant}.csv`
      )
      toast.success('Pedidos exportados', {
        description: 'CSV con BOM UTF-8 — ábrelo directo en Excel.',
      })
    } catch (err) {
      toast.error('No se pudo exportar el CSV', {
        description:
          (await csvErrorDetail(err)) ??
          'Revisa que el backend esté arriba e inténtalo de nuevo.',
      })
    } finally {
      setDescargandoCsv(false)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const byEstado = useMemo(() => {
    const map: Record<OrderEstado, Order[]> = {
      nuevo: [],
      confirmado: [],
      cocina: [],
      delivery: [],
      entregado: [],
    }
    for (const o of orders ?? []) {
      if (o.estado in map) map[o.estado].push(o)
    }
    return map
  }, [orders])

  /** Ordena dentro de la misma columna (solo cosmético, sin PATCH). */
  function reorderInColumn(scope: string, id: string, overId: string) {
    queryClient.setQueryData<Order[]>(['orders', scope], (old) => {
      if (!old) return old
      const from = old.findIndex((o) => o.id === id)
      const to = old.findIndex((o) => o.id === overId)
      if (from < 0 || to < 0 || from === to) return old
      return arrayMove(old, from, to)
    })
  }

  function resolveDrag(event: DragEndEvent | DragOverEvent) {
    const { active, over } = event
    if (!over) return null
    const from = (active.data.current as { estado?: OrderEstado } | undefined)
      ?.estado
    const to = (over.data.current as { estado?: OrderEstado } | undefined)
      ?.estado
    if (!from || !to) return null
    return { id: String(active.id), overId: String(over.id), from, to }
  }

  function handleDragEnd(event: DragEndEvent) {
    const drag = resolveDrag(event)
    if (!drag) return
    const { id, overId, from, to } = drag

    if (from === to) {
      reorderInColumn(tenant, id, overId)
      return
    }

    if (!esAvanceValido(from, to)) {
      toast.error('Los pedidos solo avanzan hacia adelante', {
        description: `${ESTADO_LABEL[from]} → ${ESTADO_LABEL[to]} no está permitido.`,
      })
      return
    }

    void advance(id, to)
  }

  const total = orders?.length ?? 0

  return (
    <>
      <Header fixed>
        <LiveBadge status={wsStatus} className='me-auto' />
        <Search />
        <ThemeSwitch />
        <NotificationsBell />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='font-display text-2xl font-bold tracking-tight'>
              Panel de pedidos
            </h2>
            <p className='text-muted-foreground'>
              Kanban de pedidos. Arrastra tarjetas hacia adelante o usa los
              botones de avance; el pago no verificado bloquea el avance.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Select
              value={tenant}
              onValueChange={(v) =>
                navigate({
                  to: '/panel',
                  search: { tenant: v === 'todos' ? undefined : v },
                })
              }
            >
              <SelectTrigger className='w-36' aria-label='Filtrar por local'>
                <SelectValue placeholder='Local' />
              </SelectTrigger>
              <SelectContent>
                {TENANT_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              disabled={descargandoCsv}
              onClick={() => void exportarCsv()}
            >
              {descargandoCsv ? (
                <RefreshCw className='size-3.5 animate-spin' />
              ) : (
                <Download className='size-3.5' />
              )}
              {descargandoCsv ? 'Exportando…' : 'Exportar CSV'}
            </Button>
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar pedidos'
              onClick={() => refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
            {demoReset.isOwner && (
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5'
                disabled={demoReset.isPending}
                onClick={() => demoReset.mutate()}
              >
                <RefreshCw className='size-3.5' /> Recargar demo
              </Button>
            )}
          </div>
        </div>

        {isError && (
          <Alert variant='destructive'>
            <AlertTitle>No se pudieron cargar los pedidos</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>{error.message}</span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => refetch()}
                className='gap-1.5'
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!isPending && !isError && total === 0 && (
          <Alert>
            <AlertTitle>No hay pedidos todavía</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-2'>
              <span>Haz un pedido desde el chat de cliente y cae aquí al momento.</span>
              <Link
                to='/cliente'
                search={{ tenant: 'faro' }}
                className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
              >
                Abrir chat de cliente
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {isPending ? (
          <div className='flex gap-4 overflow-x-auto pb-4'>
            {ORDER_ESTADOS.map((estado) => (
              <div key={estado} className='w-full md:w-64 xl:w-auto'>
                <Skeleton className='h-96 rounded-xl' />
              </div>
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={handleDragEnd}
          >
            <div className='flex gap-4 overflow-x-auto pb-4'>
              {ORDER_ESTADOS.map((estado) => (
                <KanbanColumn
                  key={estado}
                  estado={estado}
                  orders={byEstado[estado]}
                >
                  {byEstado[estado].map((order) => (
                    <OrderTicket
                      key={order.id}
                      order={order}
                      dishNames={dishNames}
                      onAdvance={(o, target) => void advance(o.id, target)}
                      isPending={isAdvancing}
                    />
                  ))}
                  {byEstado[estado].length === 0 && (
                    <p className='px-1 py-2 text-xs text-muted-foreground'>
                      Sin pedidos en {ESTADO_LABEL[estado].toLowerCase()}.
                    </p>
                  )}
                </KanbanColumn>
              ))}
            </div>
          </DndContext>
        )}
      </Main>
    </>
  )
}
