import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  AlertTriangle,
  CreditCard,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { formatFechaHora } from '@/lib/datetime'
import { useCurrentTenant } from '@/hooks/use-modules'
import { usePayConfig } from '@/hooks/use-pay-config'
import {
  useConnectPaymentsAccount,
  useDisconnectPaymentsAccount,
  usePaymentsAccount,
} from '@/hooks/use-payments-account'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CuentaEstadoBadge } from './components/cuenta-estado-badge'
import { LedgerSection } from './components/ledger-section'
import { QrYapeSection } from './components/qr-yape-section'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de staff. */
function es403Staff(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

/**
 * /configuracion/pagos — pasarela de pagos (Culqi) del local (contrato
 * pasarela-culqi): mismo patrón UX que el "Canal de WhatsApp" — badge de
 * estado (conectada verde / desconectada roja), llave pública enmascarada
 * + verified_at, formulario owner de llaves API que el servidor valida
 * contra Culqi (el rechazo se muestra tal cual) y desconexión con
 * confirmación. El staff ve el candado (patrón step-canal).
 */
export function PasarelaPagos() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'

  const cuentaQuery = usePaymentsAccount(tenant)
  const payConfigQuery = usePayConfig(tenant)
  const connect = useConnectPaymentsAccount(tenant)
  const disconnect = useDisconnectPaymentsAccount(tenant)

  const [publicKey, setPublicKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [confirmarDesconectar, setConfirmarDesconectar] = useState(false)

  const cuenta = cuentaQuery.data

  /** Cómo cobra ahora el chat de cliente (config pública del paybox). */
  const modoChat = payConfigQuery.data
    ? payConfigQuery.data.culqi_pk
      ? `Tarjeta real · ${payConfigQuery.data.culqi_pk_enmascarada || 'llave pública en el servidor'}`
      : 'Culqi (SIMULADO) — sin llaves no hay cargo real'
    : payConfigQuery.isError
      ? 'No disponible'
      : '…'

  function conectar() {
    connect.mutate(
      { publicKey: publicKey.trim(), secretKey: secretKey.trim() },
      {
        onSuccess: () => {
          setPublicKey('')
          setSecretKey('')
        },
      }
    )
  }

  function refrescar() {
    void cuentaQuery.refetch()
    void payConfigQuery.refetch()
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <NotificationsBell />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='font-display text-2xl font-bold tracking-tight md:text-3xl'>
              Pasarela de pagos (Culqi)
            </h1>
            <p className='text-muted-foreground'>
              Conecta tu cuenta de Culqi una sola vez: el chat del cliente cobra
              con tarjeta real y el servidor verifica cada cargo.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <CuentaEstadoBadge estado={cuenta?.estado} />
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar estado'
              onClick={refrescar}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {cuentaQuery.isError &&
          (isModuleDisabledError(cuentaQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(cuentaQuery.error)} />
          ) : es403Staff(cuentaQuery.error) ? (
            <Alert>
              <Lock className='size-4' />
              <AlertTitle>Solo el dueño puede ver esto</AlertTitle>
              <AlertDescription>
                Consultar y conectar la pasarela de pagos requiere rol owner.
                Pídele al dueño del local que complete este paso.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo leer el estado de la pasarela</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(cuentaQuery.error) ??
                    cuentaQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void cuentaQuery.refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <div className='mx-auto w-full max-w-3xl space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Estado de la cuenta</CardTitle>
              <CardDescription>
                Así ve tu local a la pasarela de Culqi ahora mismo.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {cuentaQuery.isPending ? (
                <div className='space-y-2'>
                  <Skeleton className='h-6 w-40' />
                  <Skeleton className='h-4 w-64' />
                  <Skeleton className='h-4 w-56' />
                </div>
              ) : (
                <>
                  <div className='flex items-center gap-3'>
                    <CuentaEstadoBadge estado={cuenta?.estado} />
                    <span className='text-sm text-muted-foreground'>
                      {cuenta?.estado === 'conectada'
                        ? 'Culqi validó las llaves: los cobros con tarjeta del chat son reales.'
                        : 'Sin llaves conectadas: el chat cobra con el simulado.'}
                    </span>
                  </div>
                  <dl className='grid gap-3 text-sm sm:grid-cols-2'>
                    <div>
                      <dt className='text-xs text-muted-foreground'>
                        Llave pública
                      </dt>
                      <dd className='truncate font-mono'>
                        {cuenta?.public_key || '— sin conectar —'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-xs text-muted-foreground'>
                        Última verificación
                      </dt>
                      <dd className='truncate font-mono'>
                        {cuenta?.verified_at
                          ? formatFechaHora(cuenta.verified_at)
                          : '— nunca —'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-xs text-muted-foreground'>
                        Proveedor
                      </dt>
                      <dd className='truncate font-mono'>
                        {cuenta?.provider || 'culqi'}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-xs text-muted-foreground'>
                        Cobro del chat de cliente
                      </dt>
                      <dd className='truncate'>{modoChat}</dd>
                    </div>
                  </dl>
                </>
              )}

              {cuenta?.estado === 'conectada' && (
                <Button
                  variant='outline'
                  className='gap-1.5'
                  disabled={!isOwner || disconnect.isPending}
                  onClick={() => setConfirmarDesconectar(true)}
                >
                  {disconnect.isPending ? (
                    <RefreshCw className='size-4 animate-spin' />
                  ) : (
                    <Unplug className='size-4' />
                  )}
                  Desconectar
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <CreditCard className='size-4 text-primary' />
                Conectar Culqi
              </CardTitle>
              <CardDescription>
                Pega las llaves de tu cuenta de Culqi: el servidor las valida
                contra la API antes de activar los cobros con tarjeta. Si Culqi
                las rechaza, aquí verás el motivo tal cual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isOwner && (
                <Alert className='mb-4'>
                  <Lock className='size-4' />
                  <AlertTitle>Solo el dueño puede hacer esto</AlertTitle>
                  <AlertDescription>
                    Conectar la pasarela de pagos requiere rol owner. Pídele al
                    dueño del local que complete este paso.
                  </AlertDescription>
                </Alert>
              )}

              <form
                className='space-y-4'
                onSubmit={(e) => {
                  e.preventDefault()
                  conectar()
                }}
              >
                <div className='space-y-2'>
                  <Label htmlFor='pay-public-key'>
                    Llave pública (pk_test…)
                  </Label>
                  <Input
                    id='pay-public-key'
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder='pk_test_xxxxxxxx'
                    autoComplete='off'
                    disabled={!isOwner}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='pay-secret-key'>
                    Llave secreta (sk_test…)
                  </Label>
                  <Input
                    id='pay-secret-key'
                    type='password'
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder='sk_test_xxxxxxxx'
                    autoComplete='off'
                    disabled={!isOwner}
                  />
                  <p className='text-xs text-muted-foreground'>
                    Panel Culqi → Desarrolladores → Llaves API
                    (integración/sandbox: pk_test/sk_test). La llave secreta
                    nunca se muestra de vuelta: el servidor la guarda y solo la
                    usa para crear cargos.
                  </p>
                </div>
                <Button
                  type='submit'
                  className='gap-1.5'
                  disabled={
                    !isOwner ||
                    connect.isPending ||
                    !publicKey.trim() ||
                    !secretKey.trim()
                  }
                >
                  {connect.isPending ? (
                    <RefreshCw className='size-4 animate-spin' />
                  ) : (
                    <ShieldCheck className='size-4' />
                  )}
                  {connect.isPending
                    ? 'Validando con Culqi…'
                    : 'Conectar y validar'}
                </Button>

                {connect.isError && (
                  <Alert variant='destructive'>
                    <AlertTriangle className='size-4' />
                    <AlertTitle>Culqi rechazó la conexión</AlertTitle>
                    <AlertDescription>
                      {apiErrorDetail(connect.error) ??
                        'No se pudo conectar la pasarela. Inténtalo de nuevo.'}
                    </AlertDescription>
                  </Alert>
                )}
              </form>
            </CardContent>
          </Card>

          {/* saas-cola-2: ledger de pagos + QR de Yape real */}
          <LedgerSection tenant={tenant} />
          <QrYapeSection
            tenant={tenant}
            isOwner={isOwner}
            tieneQr={payConfigQuery.data?.yape_qr_imagen ?? false}
          />
        </div>
      </Main>

      <ConfirmDialog
        open={confirmarDesconectar}
        onOpenChange={setConfirmarDesconectar}
        title='Desconectar Culqi'
        desc='El chat del cliente dejará de cobrar con tarjeta real y volverá al cobro simulado. Las llaves se borran del servidor; podrás reconectarlas cuando quieras.'
        confirmText='Desconectar'
        destructive
        isLoading={disconnect.isPending}
        handleConfirm={() => {
          disconnect.mutate(undefined, {
            onSuccess: () => setConfirmarDesconectar(false),
          })
        }}
        className='sm:max-w-sm'
      />
    </>
  )
}
