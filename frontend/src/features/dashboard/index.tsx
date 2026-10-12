import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Banknote,
  BookOpen,
  ChefHat,
  ClipboardList,
  Inbox,
  PlugZap,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { OrderPagoBadge } from '@/components/order-pago-badge'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOrders } from '@/hooks/use-orders'
import { useOrdersWs } from '@/hooks/use-orders-ws'
import { useTenants } from '@/hooks/use-tenants'
import { MODULE_KEYS, useModules } from '@/hooks/use-modules'
import { ESTADO_LABEL, penFormatter } from '@/lib/order-utils'
import type { Order, OrderEstado } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Resumen con datos de verdad (GET /api/orders con Bearer + invalidación
 * live por WebSocket). KPIs de hoy: todos los pedidos del store viven en
 * la sesión actual del demo, así que el total de la cola ES el total de hoy.
 */

const ESTADO_COLORS: Record<OrderEstado, string> = {
  nuevo: '#d97e27',
  confirmado: '#4e6e9e',
  cocina: '#8a5fbf',
  delivery: '#2fa3a0',
  entregado: '#3e7c5b',
}

const ESTADO_BADGE: Record<OrderEstado, string> = {
  nuevo: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  confirmado: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  cocina: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  delivery: 'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  entregado: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
}

function numeroDePedido(id: string): number {
  const n = Number.parseInt(id.replace(/\D/g, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

export function Dashboard() {
  const {
    data: orders,
    isPending,
    isError,
    error,
    refetch,
  } = useOrders('todos')
  const { data: tenants } = useTenants()
  const { isEnabled } = useModules()
  useOrdersWs() // invalida ['orders'] ante order.created/updated: KPIs en vivo

  const kpis = useMemo(() => {
    const lista = orders ?? []
    const cobrados = lista.filter((o) => o.pago.startsWith('pagado'))
    const ventas = cobrados.reduce((acc, o) => acc + (o.total ?? 0), 0)
    const ticket = cobrados.length > 0 ? ventas / cobrados.length : 0
    const fraudes = lista.filter((o) => o.pago === 'pendiente_verificar').length
    return {
      total: lista.length,
      ventas,
      ticket,
      fraudes,
      cobrados: cobrados.length,
    }
  }, [orders])

  const porEstado = useMemo(() => {
    const counts = new Map<OrderEstado, number>()
    for (const o of orders ?? []) {
      if (ESTADO_LABEL[o.estado]) {
        counts.set(o.estado, (counts.get(o.estado) ?? 0) + 1)
      }
    }
    return (Object.keys(ESTADO_LABEL) as OrderEstado[]).map((estado) => ({
      estado,
      label: ESTADO_LABEL[estado],
      pedidos: counts.get(estado) ?? 0,
    }))
  }, [orders])

  const tenantNombre = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of tenants ?? []) map[t.id] = t.nombre
    return (id: string) => map[id] ?? id
  }, [tenants])

  const ultimos = useMemo(
    () =>
      [...(orders ?? [])]
        .sort((a, b) => numeroDePedido(b.id) - numeroDePedido(a.id))
        .slice(0, 6),
    [orders]
  )

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='font-display text-2xl font-bold tracking-tight md:text-3xl'>
              Resumen
            </h1>
            <p className='text-muted-foreground'>
              Pedidos por WhatsApp, cobro verificado y cocina en vivo — datos
              del demo sandbox.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {/* CTAs de módulos: se ocultan si el módulo está apagado
                (gating de sidebar + endpoints 403). */}
            {isEnabled(MODULE_KEYS.INBOX) && (
              <Button asChild variant='outline' size='sm' className='gap-1.5'>
                <Link to='/mensajeria/inbox'>
                  <Inbox className='size-4' /> Inbox
                </Link>
              </Button>
            )}
            {isEnabled(MODULE_KEYS.WHATSAPP) && (
              <Button asChild variant='outline' size='sm' className='gap-1.5'>
                <Link to='/configuracion/whatsapp'>
                  <PlugZap className='size-4' /> Conectar WhatsApp
                </Link>
              </Button>
            )}
            {isEnabled(MODULE_KEYS.KDS) && (
              <Button asChild variant='outline' size='sm' className='gap-1.5'>
                <Link to='/cocina'>
                  <ChefHat className='size-4' /> Cocina
                </Link>
              </Button>
            )}
            {isEnabled(MODULE_KEYS.CARTA) && (
              <Button asChild variant='outline' size='sm' className='gap-1.5'>
                <Link to='/carta'>
                  <BookOpen className='size-4' /> Carta
                </Link>
              </Button>
            )}
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar datos'
              onClick={() => refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
            <Button asChild className='gap-1.5'>
              <Link to='/panel'>
                <ClipboardList className='size-4' /> Abrir panel
              </Link>
            </Button>
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

        {/* ===== KPIs de hoy ===== */}
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {isPending ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <Skeleton className='h-4 w-28' />
                  <Skeleton className='size-4' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='mb-2 h-8 w-24' />
                  <Skeleton className='h-3 w-40' />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <KpiCard
                title='Pedidos de hoy'
                value={String(kpis.total)}
                sub={`${kpis.total} pedidos vivos en la sesión del demo`}
                icon={<ShoppingCart className='size-4 text-muted-foreground' />}
              />
              <KpiCard
                title='Ventas cobradas'
                value={penFormatter.format(kpis.ventas)}
                sub={`${kpis.cobrados} pedidos con pago verificado`}
                icon={<Banknote className='size-4 text-muted-foreground' />}
              />
              <KpiCard
                title='Ticket promedio'
                value={penFormatter.format(kpis.ticket)}
                sub='por pedido cobrado'
                icon={<Receipt className='size-4 text-muted-foreground' />}
              />
              <KpiCard
                title='Fraudes bloqueados'
                value={String(kpis.fraudes)}
                sub='pagos pendientes de verificar (anti Yape-falso)'
                icon={
                  <ShieldAlert className='size-4 text-muted-foreground' />
                }
              />
            </>
          )}
        </div>

        {/* ===== Chart + últimos pedidos ===== */}
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
          <Card className='col-span-1 lg:col-span-3'>
            <CardHeader>
              <CardTitle>Pedidos por estado</CardTitle>
              <CardDescription>
                Cola actual, de nuevo a entregado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <Skeleton className='h-60 w-full rounded-xl' />
              ) : (
                <div className='h-60'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={porEstado} margin={{ top: 8, right: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray='3 3' />
                      <XAxis
                        dataKey='label'
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        fontSize={12}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={28}
                        allowDecimals={false}
                        fontSize={12}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--muted)' }}
                        contentStyle={{
                          backgroundColor: 'var(--popover)',
                          color: 'var(--popover-foreground)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'var(--popover-foreground)' }}
                        itemStyle={{ color: 'var(--popover-foreground)' }}
                      />
                      <Bar dataKey='pedidos' name='Pedidos' radius={6}>
                        {porEstado.map((d) => (
                          <Cell
                            key={d.estado}
                            fill={ESTADO_COLORS[d.estado]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className='col-span-1 lg:col-span-4'>
            <CardHeader>
              <CardTitle>Últimos pedidos</CardTitle>
              <CardDescription>
                Los 6 más recientes de todos los locales.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <div className='space-y-3'>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className='h-10 w-full' />
                  ))}
                </div>
              ) : ultimos.length === 0 ? (
                <Alert>
                  <AlertTitle>Sin pedidos aún</AlertTitle>
                  <AlertDescription className='flex flex-wrap items-center gap-2'>
                    <span>
                      Abre el chat de cliente y haz un pedido de prueba — cae
                      aquí al momento.
                    </span>
                    <Link
                      to='/cliente'
                      search={{ tenant: 'faro' }}
                      className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
                    >
                      Abrir chat de cliente
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className='hidden sm:table-cell'>
                        Local
                      </TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Pago</TableHead>
                      <TableHead className='text-end'>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ultimos.map((o: Order) => (
                      <TableRow key={o.id}>
                        <TableCell className='font-medium'>{o.id}</TableCell>
                        <TableCell>{o.cliente}</TableCell>
                        <TableCell className='hidden text-muted-foreground sm:table-cell'>
                          {tenantNombre(o.tenant)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant='outline'
                            className={cn(
                              'border-transparent',
                              ESTADO_BADGE[o.estado]
                            )}
                          >
                            {ESTADO_LABEL[o.estado] ?? o.estado}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <OrderPagoBadge pago={o.pago} />
                        </TableCell>
                        <TableCell className='text-end'>
                          {penFormatter.format(o.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {!isPending && ultimos.length > 0 && (
                <Button
                  asChild
                  variant='ghost'
                  size='sm'
                  className='mt-3 gap-1 text-muted-foreground'
                >
                  <Link to='/panel'>
                    Ver todos en el panel <ArrowRight className='size-3.5' />
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}

function KpiCard({
  title,
  value,
  sub,
  icon,
}: {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold tabular-nums'>{value}</div>
        <p className='text-xs text-muted-foreground'>{sub}</p>
      </CardContent>
    </Card>
  )
}
