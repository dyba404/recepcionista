import {
  Banknote,
  Blocks,
  BookOpen,
  CalendarClock,
  ChefHat,
  Inbox,
  ListChecks,
  Lock,
  MessageCircle,
  ReceiptText,
  RefreshCw,
  Route,
  Server,
  Star,
  type LucideIcon,
} from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { useModules, useToggleModule } from '@/hooks/use-modules'
import type { ModuleConfig } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'

/** Icono por key de módulo (fallback: Blocks). */
const MODULE_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  inbox: Inbox,
  pagos: Banknote,
  kds: ChefHat,
  carta: BookOpen,
}

/** Sección "Próximamente" (decisiones modulos-mvp #3) — display-only. */
const ROADMAP: { icon: LucideIcon; nombre: string; desc: string }[] = [
  {
    icon: CalendarClock,
    nombre: 'Reservas',
    desc: 'Reserva de mesas con confirmación automática por WhatsApp.',
  },
  {
    icon: ReceiptText,
    nombre: 'Facturación SUNAT',
    desc: 'Boletas y facturas electrónicas al confirmar el pedido.',
  },
  {
    icon: Route,
    nombre: 'Delivery routing',
    desc: 'Asignación de pedidos a repartidores por zona y carga.',
  },
  {
    icon: Star,
    nombre: 'Programas de lealtad',
    desc: 'Puntos y recompensas que el bot canjea en la conversación.',
  },
  {
    icon: ListChecks,
    nombre: 'Encuestas post-pedido',
    desc: 'NPS corto que se envía solo tras la entrega.',
  },
]

/**
 * /configuracion/modulos — registro de módulos con toggles REALES (solo
 * owner; el staff ve el switch bloqueado con candado). Apagar un módulo
 * es gating de verdad: fuera del sidebar y 403 en sus endpoints.
 */
export function Modulos() {
  const {
    data: modules,
    isPending,
    isError,
    error,
    refetch,
  } = useModules()
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'
  const toggle = useToggleModule()

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
            <h2 className='font-display text-2xl font-bold tracking-tight'>
              Módulos
            </h2>
            <p className='text-muted-foreground'>
              Activa y desactiva las piezas del producto para este local.
              Los cambios aplican al instante.
            </p>
          </div>
          <Button
            variant='outline'
            size='icon'
            aria-label='Refrescar módulos'
            onClick={() => void refetch()}
          >
            <RefreshCw className='size-4' />
          </Button>
        </div>

        {isError && (
          <Alert variant='destructive'>
            <AlertTitle>No se pudo cargar los módulos</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>{error?.message ?? 'Error al contactar al servidor'}</span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void refetch()}
                className='gap-1.5'
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isPending ? (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className='h-44 rounded-xl' />
            ))}
          </div>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {(modules ?? []).map((module) => (
              <ModuleCard
                key={module.key}
                module={module}
                isOwner={isOwner}
                pending={
                  toggle.isPending && toggle.variables?.key === module.key
                }
                onToggle={(enabled) =>
                  toggle.mutate({ key: module.key, enabled })
                }
              />
            ))}
          </div>
        )}

        <Separator className='my-2' />

        <section aria-labelledby='proximamente'>
          <div className='mb-3'>
            <h3 id='proximamente' className='text-lg font-semibold'>
              Próximamente
            </h3>
            <p className='text-sm text-muted-foreground'>
              En roadmap — llegarán como módulos con su propio interruptor.
            </p>
          </div>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {ROADMAP.map((item) => (
              <Card key={item.nombre} className='bg-muted/40'>
                <CardHeader>
                  <div className='flex items-start justify-between'>
                    <div className='flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
                      <item.icon className='size-5' />
                    </div>
                    <Badge variant='outline' className='text-muted-foreground'>
                      En roadmap
                    </Badge>
                  </div>
                  <CardTitle className='mt-3 text-base'>
                    {item.nombre}
                  </CardTitle>
                  <CardDescription>{item.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </Main>
    </>
  )
}

function ModuleCard({
  module,
  isOwner,
  pending,
  onToggle,
}: {
  module: ModuleConfig
  isOwner: boolean
  pending: boolean
  onToggle: (enabled: boolean) => void
}) {
  const Icono = MODULE_ICONS[module.key] ?? Blocks

  return (
    <Card className='flex flex-col'>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary'>
            <Icono className='size-5' />
          </div>
          <div className='flex flex-col items-end gap-1.5'>
            {module.server_gated && (
              <Badge
                variant='outline'
                className='gap-1 border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-400'
              >
                <Server className='size-3' /> Afecta al servidor
              </Badge>
            )}
            <Switch
              checked={module.enabled}
              disabled={!isOwner || pending}
              onCheckedChange={(checked) => onToggle(checked)}
              aria-label={`Activar módulo ${module.nombre}`}
            />
          </div>
        </div>
        <CardTitle className='mt-3 text-base'>{module.nombre}</CardTitle>
        <CardDescription>{module.descripcion}</CardDescription>
      </CardHeader>
      <CardContent className='mt-auto'>
        {isOwner ? (
          <p className='text-xs text-muted-foreground'>
            {module.enabled
              ? 'Activado — visible para todo el equipo.'
              : 'Desactivado — se oculta de la navegación y su API responde 403.'}
          </p>
        ) : (
          <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Lock className='size-3.5 shrink-0' />
            Solo el dueño puede activar o desactivar módulos.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
