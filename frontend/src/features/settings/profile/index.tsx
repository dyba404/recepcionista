import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound, RefreshCw, Store, UserCog } from 'lucide-react'
import { api } from '@/lib/api'
import type { AuthUser } from '@/lib/types'
import { useTenants } from '@/hooks/use-tenants'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { ContentSection } from '../components/content-section'
import { CambiarPasswordDialog } from './components/cambiar-password-dialog'
import { EditarNombreDialog } from './components/editar-nombre-dialog'

/**
 * Perfil (contrato horarios-pausa-notif-perfil, D): datos reales de
 * GET /api/auth/me + local de GET /api/tenants.
 * - "Datos": nombre editable (Dialog → PATCH /api/auth/me {nombre}).
 * - "Contraseña": Dialog actual/nueva/confirmar con validación client y
 *   error verbatim del backend ("Contraseña actual incorrecta").
 * El local sigue siendo solo lectura (se edita en /locales).
 */

function Fila({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='grid grid-cols-[8rem_1fr] items-start gap-2 text-sm sm:grid-cols-[10rem_1fr]'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 font-medium break-words'>{children}</dd>
    </div>
  )
}

export function SettingsProfile() {
  const [editarOpen, setEditarOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  /** Sesión de edición: remonta el dialog con estado fresco (patrón carta). */
  const [sesionNombre, setSesionNombre] = useState(0)
  const [sesionPassword, setSesionPassword] = useState(0)

  const {
    data: me,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get<AuthUser>('/api/auth/me')
      return res.data
    },
  })
  const { data: tenants } = useTenants()
  const tenant = tenants?.find((t) => t.id === me?.tenant_id)

  const rolBadge =
    me?.rol === 'owner' ? (
      <Badge className='border-transparent bg-emerald-600 text-white'>
        Dueño
      </Badge>
    ) : me?.rol === 'admin' ? (
      <Badge className='border-transparent bg-blue-600 text-white'>
        Administrador
      </Badge>
    ) : (
      <Badge className='border-transparent bg-amber-500 text-black'>
        Staff
      </Badge>
    )

  return (
    <ContentSection
      title='Perfil'
      desc='Tu cuenta y los datos del local que administras.'
    >
      {isError && (
        <Alert variant='destructive' className='mb-6'>
          <AlertTitle>No se pudo cargar tu perfil</AlertTitle>
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

      {isPending ? (
        <div className='space-y-3'>
          <Skeleton className='h-24 w-full rounded-xl' />
          <Skeleton className='h-40 w-full rounded-xl' />
        </div>
      ) : me ? (
        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <UserCog className='size-4 text-muted-foreground' /> Datos
              </CardTitle>
              <CardDescription>
                Tu nombre y email de acceso (el email no se cambia).
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <dl className='space-y-3'>
                <Fila label='Nombre'>{me.nombre}</Fila>
                <Fila label='Email'>{me.email}</Fila>
                <Fila label='Rol'>{rolBadge}</Fila>
              </dl>
              <Button
                onClick={() => {
                  setSesionNombre((n) => n + 1)
                  setEditarOpen(true)
                }}
              >
                Editar
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <KeyRound className='size-4 text-muted-foreground' />{' '}
                Contraseña
              </CardTitle>
              <CardDescription>
                Cambia tu contraseña; tu sesión actual sigue abierta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant='outline'
                onClick={() => {
                  setSesionPassword((n) => n + 1)
                  setPasswordOpen(true)
                }}
              >
                Cambiar contraseña
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Store className='size-4 text-muted-foreground' /> Local
              </CardTitle>
              <CardDescription>
                Configuración operativa del local (solo lectura; se edita en
                Locales).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenant ? (
                <dl className='space-y-3'>
                  <Fila label='Nombre'>{tenant.nombre}</Fila>
                  <Fila label='Rubro'>{tenant.rubro}</Fila>
                  <Fila label='Distrito'>{tenant.distrito}</Fila>
                  <Fila label='Delivery'>
                    {tenant.delivery > 0
                      ? `S/ ${tenant.delivery.toFixed(2)}`
                      : 'Gratis'}
                  </Fila>
                  <Fila label='Tiempo'>{tenant.tiempo}</Fila>
                  <Fila label='Yape QR'>
                    <code className='rounded bg-muted px-1.5 py-0.5 text-xs'>
                      {tenant.yape_qr}
                    </code>
                  </Fila>
                </dl>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  Tu usuario no está asociado a ningún local
                  {me.tenant_id ? ` (${me.tenant_id})` : ''}.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <EditarNombreDialog
        key={`nombre-${sesionNombre}`}
        open={editarOpen}
        onOpenChange={setEditarOpen}
        nombreActual={me?.nombre ?? ''}
      />
      <CambiarPasswordDialog
        key={`password-${sesionPassword}`}
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />

      <Separator className='mt-8' />
    </ContentSection>
  )
}
