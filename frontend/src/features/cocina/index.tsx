import { useMemo } from 'react'
import { ChefHat, RefreshCw } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LiveBadge } from '@/components/live-badge'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdvanceOrder } from '@/hooks/use-advance-order'
import { useDishNames } from '@/hooks/use-dish-names'
import { useOrders } from '@/hooks/use-orders'
import { useOrdersWs } from '@/hooks/use-orders-ws'
import { useTenants } from '@/hooks/use-tenants'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import type { Order } from '@/lib/types'
import { KdsTicket } from './components/kds-ticket'

const KDS_SCOPE = 'kds'

/** Solo pedidos pagados y verificados entran a la cola (confirmado|cocina). */
function esColaKds(o: Order): boolean {
  return (
    (o.estado === 'confirmado' || o.estado === 'cocina') &&
    o.pago.startsWith('pagado')
  )
}

export function Cocina() {
  const { data: orders, isPending, isError, error, refetch } = useOrders(KDS_SCOPE)
  const { data: tenants } = useTenants()
  const wsStatus = useOrdersWs()
  const { advance, isPending: isAdvancing } = useAdvanceOrder(KDS_SCOPE)
  const dishNames = useDishNames()

  const cola = useMemo(
    () => (orders ?? []).filter(esColaKds),
    [orders]
  )

  const tenantNombre = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of tenants ?? []) map[t.id] = t.nombre
    return (id: string) => map[id] ?? id
  }, [tenants])

  return (
    <>
      <Header fixed>
        <LiveBadge status={wsStatus} className='me-auto' />
        <Search />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Cocina</h2>
            <p className='text-muted-foreground'>
              Cola KDS en vivo: solo pedidos con pago verificado. Un tap
              avanza el pedido.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <span className='text-sm text-muted-foreground'>
              {cola.length} en cola
            </span>
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar cola'
              onClick={() => refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {isError &&
          (isModuleDisabledError(error) ? (
            <ModuleDisabled detail={apiErrorDetail(error)} />
          ) : (
            <Alert variant='destructive'>
              <ChefHat className='size-4' />
              <AlertTitle>No se pudo cargar la cola</AlertTitle>
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
          ))}

        {isPending && (
          <div className='grid gap-4 md:grid-cols-2 2xl:grid-cols-3'>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-72 rounded-xl' />
            ))}
          </div>
        )}

        {!isPending && !isError && cola.length === 0 && (
          <Alert>
            <ChefHat className='size-4' />
            <AlertTitle>Cola libre</AlertTitle>
            <AlertDescription>
              Los pedidos pagados caen aquí solos (live por WebSocket).
            </AlertDescription>
          </Alert>
        )}

        {!isPending && cola.length > 0 && (
          <div className='grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3'>
            {cola.map((order) => (
              <KdsTicket
                key={order.id}
                order={order}
                dishNames={dishNames}
                tenantNombre={tenantNombre(order.tenant)}
                onAdvance={(o, target) => void advance(o.id, target)}
                isPending={isAdvancing}
              />
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
