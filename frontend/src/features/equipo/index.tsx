import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  AlertTriangle,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserRoundPlus,
  Users,
} from 'lucide-react'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { useCurrentTenant } from '@/hooks/use-modules'
import { useInviteStaff, useRemoveStaff, useStaff } from '@/hooks/use-staff'
import { useAuthStore } from '@/stores/auth-store'
import type { StaffMember } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de staff. */
function es403Staff(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

function iniciales(nombre: string, email: string): string {
  const base = nombre || email
  return (
    base
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

function RolChip({ rol }: { rol: string }) {
  if (rol === 'owner') {
    return (
      <Badge className='gap-1 bg-emerald-600 text-white'>
        <ShieldCheck className='size-3' /> Dueño
      </Badge>
    )
  }
  return (
    <Badge variant='outline' className='gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400'>
      <KeyRound className='size-3' /> Staff
    </Badge>
  )
}

/**
 * /configuracion/equipo (contrato saas-cola-2): lista del staff del local,
 * invitar (email/password/nombre) y eliminar (ConfirmDialog). Todo es
 * owner-only: el staff ve el candado (patrón step-canal/pagos). Los errores
 * del backend se muestran inline tal cual (409 dup, "no puedes
 * eliminarte"…).
 */
export function Equipo() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'

  const staffQuery = useStaff(tenant)
  const invite = useInviteStaff(tenant)
  const remove = useRemoveStaff(tenant)

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [pendienteEliminar, setPendienteEliminar] = useState<StaffMember | null>(
    null
  )
  const [eliminarError, setEliminarError] = useState<string | null>(null)

  function invitar() {
    setInviteError(null)
    if (!email.trim()) {
      setInviteError('Escribe el correo de tu integrante.')
      return
    }
    if (!nombre.trim()) {
      setInviteError('Escribe el nombre de tu integrante.')
      return
    }
    if (password.length < 8) {
      setInviteError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    invite.mutate(
      { email, password, nombre },
      {
        onSuccess: () => {
          setNombre('')
          setEmail('')
          setPassword('')
        },
        onError: (err) => {
          setInviteError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  function eliminar() {
    if (!pendienteEliminar) return
    remove.mutate(pendienteEliminar.id, {
      onSuccess: () => {
        setPendienteEliminar(null)
        setEliminarError(null)
      },
      onError: (err) => {
        setEliminarError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  const staff = staffQuery.data ?? []

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
              Equipo
            </h1>
            <p className='text-muted-foreground'>
              Invita a tu equipo para que atiendan el inbox y la cocina de este
              local. Cada integrante entra con su propio correo.
            </p>
          </div>
          <Button
            variant='outline'
            size='icon'
            aria-label='Refrescar equipo'
            disabled={staffQuery.isPending}
            onClick={() => void staffQuery.refetch()}
          >
            <RefreshCw className='size-4' />
          </Button>
        </div>

        <div className='mx-auto w-full max-w-3xl space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Users className='size-4 text-primary' />
                Equipo del local
              </CardTitle>
              <CardDescription>
                Quién puede entrar a este local ahora mismo. El dueño no se
                puede eliminar ni editar.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {staffQuery.isPending && (
                <div className='space-y-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </div>
              )}

              {staffQuery.isError &&
                (isModuleDisabledError(staffQuery.error) ? (
                  <ModuleDisabled detail={apiErrorDetail(staffQuery.error)} />
                ) : es403Staff(staffQuery.error) ? (
                  <Alert>
                    <Lock className='size-4' />
                    <AlertTitle>Solo el dueño puede ver el equipo</AlertTitle>
                    <AlertDescription>
                      Gestionar integrantes requiere rol owner. Pídele al dueño
                      del local que invite al equipo desde aquí.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant='destructive'>
                    <AlertTitle>No se pudo cargar el equipo</AlertTitle>
                    <AlertDescription className='flex flex-wrap items-center gap-3'>
                      <span>
                        {apiErrorDetail(staffQuery.error) ??
                          staffQuery.error.message}
                      </span>
                      <Button
                        size='sm'
                        variant='outline'
                        className='gap-1.5'
                        onClick={() => void staffQuery.refetch()}
                      >
                        <RefreshCw className='size-3.5' /> Reintentar
                      </Button>
                    </AlertDescription>
                  </Alert>
                ))}

              {!staffQuery.isPending && !staffQuery.isError && (
                <div className='overflow-hidden rounded-lg border'>
                  <Table>
                    <TableHeader className='bg-muted/50'>
                      <TableRow>
                        <TableHead>Integrante</TableHead>
                        <TableHead className='w-28'>Rol</TableHead>
                        <TableHead className='w-28'>Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {staff.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className='h-20 text-center text-muted-foreground'
                          >
                            Nadie en el equipo todavía.
                          </TableCell>
                        </TableRow>
                      )}
                      {staff.map((member) => (
                        <TableRow key={String(member.id)}>
                          <TableCell>
                            <div className='flex items-center gap-2.5'>
                              <Avatar className='size-8'>
                                <AvatarFallback className='bg-primary/10 text-xs font-semibold text-primary'>
                                  {iniciales(member.nombre, member.email)}
                                </AvatarFallback>
                              </Avatar>
                              <div className='min-w-0'>
                                <div className='truncate text-sm font-medium'>
                                  {member.nombre || member.email}
                                </div>
                                <div className='truncate text-xs text-muted-foreground'>
                                  {member.email}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <RolChip rol={member.rol} />
                          </TableCell>
                          <TableCell>
                            {member.rol === 'staff' ? (
                              <Button
                                variant='outline'
                                size='sm'
                                className='gap-1.5 text-destructive hover:text-destructive'
                                disabled={!isOwner || remove.isPending}
                                onClick={() => {
                                  setPendienteEliminar(member)
                                  setEliminarError(null)
                                }}
                              >
                                Eliminar
                              </Button>
                            ) : (
                              <span className='text-xs text-muted-foreground'>
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <UserRoundPlus className='size-4 text-primary' />
                Invitar a tu equipo
              </CardTitle>
              <CardDescription>
                Crea la cuenta de un integrante (rol staff): entra con este
                correo y contraseña, y ve el inbox, la cocina y el panel — sin
                acceso a la configuración.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isOwner && (
                <Alert className='mb-4'>
                  <Lock className='size-4' />
                  <AlertTitle>Solo el dueño puede hacer esto</AlertTitle>
                  <AlertDescription>
                    Invitar integrantes requiere rol owner. Pídele al dueño
                    del local que complete este paso.
                  </AlertDescription>
                </Alert>
              )}

              <form
                className='space-y-4'
                onSubmit={(e) => {
                  e.preventDefault()
                  invitar()
                }}
              >
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label htmlFor='staff-nombre'>Nombre</Label>
                    <Input
                      id='staff-nombre'
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder='Ej. Marco Cocina'
                      autoComplete='off'
                      disabled={!isOwner || invite.isPending}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='staff-email'>Correo</Label>
                    <Input
                      id='staff-email'
                      type='email'
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder='integrante@local.pe'
                      autoComplete='off'
                      disabled={!isOwner || invite.isPending}
                    />
                  </div>
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='staff-password'>Contraseña</Label>
                  <Input
                    id='staff-password'
                    type='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder='Mínimo 8 caracteres'
                    autoComplete='new-password'
                    disabled={!isOwner || invite.isPending}
                  />
                  <p className='text-xs text-muted-foreground'>
                    Se la compartes a tu integrante para su primer ingreso; que
                    la cambie después.
                  </p>
                </div>
                <Button
                  type='submit'
                  className='gap-1.5'
                  disabled={!isOwner || invite.isPending}
                >
                  {invite.isPending ? (
                    <RefreshCw className='size-4 animate-spin' />
                  ) : (
                    <UserRoundPlus className='size-4' />
                  )}
                  {invite.isPending ? 'Creando cuenta…' : 'Invitar al equipo'}
                </Button>

                {invite.isError && inviteError && (
                  <Alert variant='destructive'>
                    <AlertTriangle className='size-4' />
                    <AlertTitle>No se pudo invitar</AlertTitle>
                    <AlertDescription>{inviteError}</AlertDescription>
                  </Alert>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </Main>

      <ConfirmDialog
        open={pendienteEliminar !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendienteEliminar(null)
            setEliminarError(null)
          }
        }}
        title='Eliminar del equipo'
        desc={
          pendienteEliminar
            ? `¿Eliminar a ${pendienteEliminar.nombre || pendienteEliminar.email} (${pendienteEliminar.email})? Su cuenta deja de entrar a este local.`
            : ''
        }
        confirmText='Eliminar'
        destructive
        isLoading={remove.isPending}
        handleConfirm={eliminar}
        className='sm:max-w-sm'
      >
        {eliminarError && (
          <p role='alert' className='text-sm font-medium text-destructive'>
            {eliminarError}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
