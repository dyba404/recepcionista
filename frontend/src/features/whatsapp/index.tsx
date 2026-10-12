import { useState } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
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
import { Card, CardContent } from '@/components/ui/card'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { useCurrentTenant } from '@/hooks/use-modules'
import { useWhatsAppStatus } from '@/hooks/use-whatsapp'
import { useAuthStore } from '@/stores/auth-store'
import { CanalEstadoBadge } from './components/canal-estado-badge'
import { Stepper, type PasoWizard } from './components/stepper'
import { StepCanal } from './components/step-canal'
import { StepDatosApp } from './components/step-datos-app'
import { StepVerificacion } from './components/step-verificacion'

const PASOS: PasoWizard[] = [
  { titulo: 'App en Meta', desc: 'Crea la app y copia los datos' },
  { titulo: 'Conectar canal', desc: 'Número de prueba y webhook' },
  { titulo: 'Verificación', desc: 'Meta confirma la conexión' },
]

/**
 * /configuracion/whatsapp — wizard de 3 pasos del canal WhatsApp (Meta Cloud
 * API oficial, decisión #1 de modulos-mvp). El paso 3 hace polling de
 * GET /api/whatsapp/status hasta estado "conectado".
 */
export function ConectarWhatsapp() {
  const tenant = useCurrentTenant()
  const [paso, setPaso] = useState(0)
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'

  // Polling solo mientras el paso de verificación está abierto
  const statusQuery = useWhatsAppStatus(tenant, paso === 2 ? 3_000 : false)

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
              Conectar WhatsApp
            </h1>
            <p className='text-muted-foreground'>
              Canal oficial Meta Cloud API — wizard de una sola vez por
              local.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <CanalEstadoBadge estado={statusQuery.data?.estado} />
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar estado'
              onClick={() => void statusQuery.refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {statusQuery.isError &&
          (isModuleDisabledError(statusQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(statusQuery.error)} />
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo leer el estado del canal</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>{statusQuery.error.message}</span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void statusQuery.refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <Card className='py-4'>
          <CardContent>
            <Stepper steps={PASOS} current={paso} onStepClick={setPaso} />
          </CardContent>
        </Card>

        <div className='mx-auto w-full max-w-3xl space-y-4'>
          {paso === 0 && <StepDatosApp statusQuery={statusQuery} />}
          {paso === 1 && (
            <StepCanal
              statusQuery={statusQuery}
              tenant={tenant}
              isOwner={isOwner}
            />
          )}
          {paso === 2 && <StepVerificacion statusQuery={statusQuery} />}
        </div>

        <div className='mx-auto flex w-full max-w-3xl items-center justify-between gap-2'>
          <Button
            variant='outline'
            disabled={paso === 0}
            onClick={() => setPaso((p) => Math.max(0, p - 1))}
            className='gap-1.5'
          >
            <ArrowLeft className='size-4' /> Anterior
          </Button>
          {paso < PASOS.length - 1 ? (
            <Button
              onClick={() => setPaso((p) => Math.min(PASOS.length - 1, p + 1))}
              className='gap-1.5'
            >
              Siguiente <ArrowRight className='size-4' />
            </Button>
          ) : (
            <Button asChild variant='outline' className='gap-1.5'>
              <Link to='/mensajeria/inbox'>Ir al Inbox</Link>
            </Button>
          )}
        </div>
      </Main>
    </>
  )
}
