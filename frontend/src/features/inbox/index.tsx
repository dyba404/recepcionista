import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Inbox as InboxIcon, PlugZap, RefreshCw } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LiveBadge } from '@/components/live-badge'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Skeleton } from '@/components/ui/skeleton'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import {
  useConversations,
  useUnreadTotal,
} from '@/hooks/use-conversations'
import { useOrdersWs } from '@/hooks/use-orders-ws'
import { useCurrentTenant } from '@/hooks/use-modules'
import { useStaff } from '@/hooks/use-staff'
import { useWhatsAppStatus } from '@/hooks/use-whatsapp'
import { useAuthStore } from '@/stores/auth-store'
import { ConversationList } from './components/conversation-list'
import { Thread, type StaffOption } from './components/thread'

/**
 * /mensajeria/inbox — handoff humano estilo Chatwoot: panel izquierdo con
 * la lista (búsqueda, filtros por estado con contadores, "solo mías") y
 * panel derecho con el hilo, acciones de handoff y composer. Todo vive
 * por WebSocket (message.created / conversation.updated) sobre la query
 * canónica ['conversations', tenant].
 */
export function Inbox() {
  const wsStatus = useOrdersWs()
  const me = useAuthStore((s) => s.auth.user)
  const tenant = useCurrentTenant()
  const canal = useWhatsAppStatus(tenant)
  const canalEstado = canal.data?.estado
  const {
    data: conversations,
    isPending,
    isError,
    error,
    refetch,
  } = useConversations()
  const unread = useUnreadTotal()

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const seleccionada = useMemo(
    () =>
      (conversations ?? []).find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  )

  /**
   * Equipo asignable (contrato saas-cola-2): el owner lista el equipo real
   * con GET /api/staff. Si falla (404/403) o viene vacío, mantenemos el
   * comportamiento previo: usuario de la sesión + staff que ya aparece
   * asignado en conversaciones.
   */
  const isOwner = me?.rol === 'owner'
  const staffQuery = useStaff(tenant, isOwner)

  const staffOptions = useMemo<StaffOption[]>(() => {
    const equipo = staffQuery.data
    if (equipo && equipo.length > 0) {
      return equipo.map((s) => ({
        id: String(s.id),
        nombre: s.nombre || s.email,
        email: s.email,
      }))
    }
    const map = new Map<string, string>()
    if (me) map.set(String(me.id), me.nombre || me.email)
    for (const c of conversations ?? []) {
      if (c.assigned_to != null && c.assigned_nombre) {
        map.set(String(c.assigned_to), c.assigned_nombre)
      }
    }
    return Array.from(map, ([id, nombre]) => ({ id, nombre }))
  }, [staffQuery.data, me, conversations])

  return (
    <>
      <Header fixed>
        <LiveBadge status={wsStatus} className='me-auto' />
        <Search />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed className='gap-4'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='font-display text-2xl font-bold tracking-tight'>
              Inbox
            </h2>
            <p className='text-muted-foreground'>
              Conversaciones WhatsApp y del simulador, con handoff bot ↔
              humano en vivo.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {unread > 0 && (
              <Badge className='bg-primary text-primary-foreground'>
                {unread} sin leer
              </Badge>
            )}
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar conversaciones'
              onClick={() => void refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {canalEstado && canalEstado !== 'conectado' && (
          <Alert>
            <PlugZap className='size-4' />
            <AlertTitle>Aún no conectas el número de WhatsApp</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>
                Sin el canal real, el bot solo recibe los mensajes del
                simulador demo. Conéctalo para atender clientes de verdad.
              </span>
              <Button size='sm' asChild className='gap-1.5'>
                <Link to='/configuracion/whatsapp'>Conectar WhatsApp</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isError &&
          (isModuleDisabledError(error) ? (
            <ModuleDisabled detail={apiErrorDetail(error)} />
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudieron cargar las conversaciones</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>{error.message}</span>
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
          ))}

        {isPending ? (
          <div className='grid min-h-0 flex-1 gap-4 lg:grid-cols-[20rem_1fr]'>
            <Skeleton className='h-full rounded-lg' />
            <Skeleton className='h-full rounded-lg' />
          </div>
        ) : (
          <div className='grid min-h-0 flex-1 gap-4 lg:grid-cols-[20rem_1fr]'>
            <ConversationList
              conversations={conversations}
              isPending={isPending}
              selectedId={selectedId}
              onSelect={setSelectedId}
              className={seleccionada ? 'hidden lg:flex' : 'flex'}
            />

            {seleccionada ? (
              <Thread
                conversation={seleccionada}
                staffOptions={staffOptions}
                onBack={() => setSelectedId(null)}
                className='flex'
              />
            ) : (
              <div className='hidden min-h-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center lg:flex'>
                <InboxIcon className='size-10 text-muted-foreground/40' />
                <div>
                  <p className='font-medium'>Selecciona una conversación</p>
                  <p className='max-w-xs text-sm text-muted-foreground'>
                    El hilo, las acciones de handoff y el composer aparecen
                    aquí.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
