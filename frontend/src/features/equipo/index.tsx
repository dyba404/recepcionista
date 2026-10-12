import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  AlertTriangle,
  CircleCheck,
  Info,
  KeyRound,
  Link2,
  Lock,
  RefreshCw,
  UserRoundPlus,
  Users,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { formatFechaHora } from '@/lib/datetime'
import type { StaffMember } from '@/lib/types'
import { useCurrentTenant } from '@/hooks/use-modules'
import { useInviteLink } from '@/hooks/use-invitaciones'
import {
  useInviteStaff,
  useRemoveStaff,
  useStaff,
  useUpdateStaff,
} from '@/hooks/use-staff'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CopyButton } from '@/features/whatsapp/components/copy-button'
import { ETIQUETA_ROL } from './etiqueta-rol'
import { RolChip } from './components/rol-chip'
import { InvitacionesPendientes } from './components/invitaciones-pendientes'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de rol. */
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

/**
 * Opción del select de rol: etiqueta + descripción de la matriz (y candado
 * cuando la opción está reservada al dueño).
 */
function RolOpcion({
  etiqueta,
  descripcion,
  candado,
}: {
  etiqueta: string
  descripcion: string
  candado?: boolean
}) {
  return (
    <span className='flex flex-col items-start gap-0.5'>
      <span className='flex items-center gap-1.5'>
        {etiqueta}
        {candado && <Lock className='size-3 text-muted-foreground' />}
      </span>
      <span className='text-xs text-muted-foreground'>{descripcion}</span>
    </span>
  )
}

/**
 * /configuracion/equipo (contrato roles-equipo, patrón Chatwoot): lista del
 * staff con su rol, invitar con rol (solo el dueño invita administradores)
 * por contraseña (crea la cuenta aquí) o por enlace (contrato
 * endurecer-local: POST /api/staff/invite → link copiable + lista de
 * pendientes con revocación), cambio de rol en línea con PATCH (staff↔admin,
 * solo dueño) y eliminar según la matriz (owner: staff y admins; admin: solo
 * staff; nunca dueños). Los errores del backend se muestran inline tal cual
 * (409 dup, "último dueño", "Tu rol no permite manage_team"…); el que no
 * tiene manage_team ve el candado (patrón step-canal/pagos).
 */
export function Equipo() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'
  const isAdmin = me?.rol === 'admin'
  /** manage_team: owner y admin invitan/gestionan; staff ve candados. */
  const puedeGestionar = isOwner || isAdmin

  const staffQuery = useStaff(tenant)
  const invite = useInviteStaff(tenant)
  const inviteLink = useInviteLink(tenant)
  const remove = useRemoveStaff(tenant)
  const update = useUpdateStaff(tenant)

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rolInvitar, setRolInvitar] = useState<'staff' | 'admin'>('staff')
  const [inviteError, setInviteError] = useState<string | null>(null)
  /** Modo del form de invitar: crear la cuenta aquí (actual) o enlace. */
  const [modoInvitar, setModoInvitar] = useState<'password' | 'link'>(
    'password'
  )
  const [linkError, setLinkError] = useState<string | null>(null)
  const [pendienteEliminar, setPendienteEliminar] =
    useState<StaffMember | null>(null)
  const [eliminarError, setEliminarError] = useState<string | null>(null)
  const [rolError, setRolError] = useState<{
    id: string | number
    mensaje: string
  } | null>(null)

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
      { email, password, nombre, rol: rolInvitar },
      {
        onSuccess: () => {
          setNombre('')
          setEmail('')
          setPassword('')
          setRolInvitar('staff')
        },
        onError: (err) => {
          setInviteError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  /**
   * Invitar por enlace (contrato endurecer-local): POST /api/staff/invite
   * con email+rol → el Alert success muestra el link para copiar y su
   * expiración; el error del backend (409 dup, 403 de rol) va inline.
   */
  function invitarPorEnlace() {
    setLinkError(null)
    if (!email.trim()) {
      setLinkError('Escribe el correo de tu integrante.')
      return
    }
    inviteLink.mutate(
      { email, rol: rolInvitar },
      {
        onSuccess: () => {
          setEmail('')
          setRolInvitar('staff')
        },
        onError: (err) => {
          setLinkError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  /** Cambio de rol en línea (PATCH): error del backend verbatim en la fila. */
  function cambiarRol(member: StaffMember, rol: 'staff' | 'admin') {
    if (rol === member.rol) return
    setRolError(null)
    update.mutate(
      { userId: member.id, rol, nombre: member.nombre || member.email },
      {
        onError: (err) => {
          setRolError({
            id: member.id,
            mensaje: apiErrorDetail(err) ?? err.message,
          })
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

  /** Matriz de eliminación: owner → staff y admins (nunca dueños); admin → solo staff. */
  function puedeEliminar(member: StaffMember): boolean {
    if (isOwner) return member.rol !== 'owner'
    return isAdmin && member.rol === 'staff'
  }

  /** Matriz del select inline: solo el dueño cambia roles (staff↔admin). */
  function puedeCambiarRol(member: StaffMember): boolean {
    return isOwner && (member.rol === 'staff' || member.rol === 'admin')
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
              Equipo
            </h1>
            <p className='text-muted-foreground'>
              Invita a tu equipo y define quién administra y quién atiende. Cada
              integrante entra con su propio correo.
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
                puede eliminar ni editar; el resto cambia de rol con el selector
                de su fila (solo el dueño).
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
                    <AlertTitle>
                      Solo el dueño o un administrador pueden ver el equipo
                    </AlertTitle>
                    <AlertDescription>
                      Gestionar integrantes requiere rol de dueño o
                      administrador. Pídele al dueño del local que invite al
                      equipo desde aquí.
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
                        <TableHead className='w-44'>Rol</TableHead>
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
                            {puedeCambiarRol(member) ? (
                              <div className='space-y-1'>
                                <Select
                                  value={
                                    member.rol === 'admin' ? 'admin' : 'staff'
                                  }
                                  onValueChange={(v) =>
                                    cambiarRol(member, v as 'staff' | 'admin')
                                  }
                                  disabled={
                                    update.isPending &&
                                    update.variables?.userId === member.id
                                  }
                                >
                                  <SelectTrigger
                                    size='sm'
                                    className='w-36'
                                    aria-label={`Cambiar rol de ${member.nombre || member.email}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value='staff'>Staff</SelectItem>
                                    <SelectItem value='admin'>
                                      Administrador
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                {rolError?.id === member.id && (
                                  <p
                                    role='alert'
                                    className='text-xs font-medium text-destructive'
                                  >
                                    {rolError.mensaje}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <RolChip rol={member.rol} />
                            )}
                          </TableCell>
                          <TableCell>
                            {puedeEliminar(member) ? (
                              <Button
                                variant='outline'
                                size='sm'
                                className='gap-1.5 text-destructive hover:text-destructive'
                                disabled={
                                  !puedeGestionar ||
                                  (remove.isPending &&
                                    pendienteEliminar?.id === member.id)
                                }
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
                Crea la cuenta de una vez (con contraseña) o genera un enlace
                para que tu integrante la cree él mismo; el rol decide qué
                puede hacer dentro del local.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!puedeGestionar && (
                <Alert className='mb-4'>
                  <Lock className='size-4' />
                  <AlertTitle>
                    Solo el dueño o un administrador pueden hacer esto
                  </AlertTitle>
                  <AlertDescription>
                    Invitar integrantes requiere rol de dueño o administrador.
                    Pídele al dueño del local que complete este paso.
                  </AlertDescription>
                </Alert>
              )}

              <Tabs
                value={modoInvitar}
                onValueChange={(v) => setModoInvitar(v as 'password' | 'link')}
              >
                <TabsList className='grid w-full grid-cols-2 sm:max-w-md'>
                  <TabsTrigger value='password' className='gap-1.5'>
                    <KeyRound className='size-3.5' />
                    Con contraseña (rápido)
                  </TabsTrigger>
                  <TabsTrigger value='link' className='gap-1.5'>
                    <Link2 className='size-3.5' />
                    Por enlace
                  </TabsTrigger>
                </TabsList>

                {/* ===== Modo actual: crear la cuenta aquí mismo ===== */}
                <TabsContent value='password'>
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
                          disabled={!puedeGestionar || invite.isPending}
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
                          disabled={!puedeGestionar || invite.isPending}
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
                        disabled={!puedeGestionar || invite.isPending}
                      />
                      <p className='text-xs text-muted-foreground'>
                        Se la compartes a tu integrante para su primer ingreso; que
                        la cambie después.
                      </p>
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='staff-rol'>Rol</Label>
                      <Select
                        value={rolInvitar}
                        onValueChange={(v) =>
                          setRolInvitar(v as 'staff' | 'admin')
                        }
                        disabled={!puedeGestionar || invite.isPending}
                      >
                        <SelectTrigger id='staff-rol' className='w-full'>
                          {rolInvitar === 'admin' ? 'Administrador' : 'Staff'}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='staff'>
                            <RolOpcion
                              etiqueta='Staff'
                              descripcion='Atiende el inbox y avanza pedidos'
                            />
                          </SelectItem>
                          <SelectItem value='admin' disabled={!isOwner}>
                            <RolOpcion
                              etiqueta='Administrador'
                              descripcion='Además gestiona equipo, carta y configuración'
                              candado={!isOwner}
                            />
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {!isOwner && (
                        <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                          <Lock className='size-3.5 shrink-0' />
                          Solo el dueño invita administradores.
                        </p>
                      )}
                    </div>
                    <Button
                      type='submit'
                      className='gap-1.5'
                      disabled={!puedeGestionar || invite.isPending}
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
                </TabsContent>

                {/* ===== Modo enlace (contrato endurecer-local, sección C) ===== */}
                <TabsContent value='link'>
                  <form
                    className='space-y-4'
                    onSubmit={(e) => {
                      e.preventDefault()
                      invitarPorEnlace()
                    }}
                  >
                    <div className='grid gap-4 sm:grid-cols-2'>
                      <div className='space-y-2'>
                        <Label htmlFor='invite-link-email'>Correo</Label>
                        <Input
                          id='invite-link-email'
                          type='email'
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder='integrante@local.pe'
                          autoComplete='off'
                          disabled={!puedeGestionar || inviteLink.isPending}
                        />
                        <p className='text-xs text-muted-foreground'>
                          Solo para saber a quién pertenece el enlace: el
                          correo se valida al aceptar la invitación.
                        </p>
                      </div>
                      <div className='space-y-2'>
                        <Label htmlFor='invite-link-rol'>Rol</Label>
                        <Select
                          value={rolInvitar}
                          onValueChange={(v) =>
                            setRolInvitar(v as 'staff' | 'admin')
                          }
                          disabled={!puedeGestionar || inviteLink.isPending}
                        >
                          <SelectTrigger id='invite-link-rol' className='w-full'>
                            {rolInvitar === 'admin' ? 'Administrador' : 'Staff'}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='staff'>
                              <RolOpcion
                                etiqueta='Staff'
                                descripcion='Atiende el inbox y avanza pedidos'
                              />
                            </SelectItem>
                            <SelectItem value='admin' disabled={!isOwner}>
                              <RolOpcion
                                etiqueta='Administrador'
                                descripcion='Además gestiona equipo, carta y configuración'
                                candado={!isOwner}
                              />
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {!isOwner && (
                          <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                            <Lock className='size-3.5 shrink-0' />
                            Solo el dueño invita administradores.
                          </p>
                        )}
                      </div>
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      Se genera un enlace válido 7 días: tu integrante lo abre
                      y crea su propia contraseña. El envío por correo llega
                      con Resend (pendiente) — mientras, compártelo por
                      WhatsApp.
                    </p>
                    <Button
                      type='submit'
                      className='gap-1.5'
                      disabled={!puedeGestionar || inviteLink.isPending}
                    >
                      {inviteLink.isPending ? (
                        <RefreshCw className='size-4 animate-spin' />
                      ) : (
                        <Link2 className='size-4' />
                      )}
                      {inviteLink.isPending
                        ? 'Creando invitación…'
                        : 'Crear invitación'}
                    </Button>

                    {inviteLink.isError && linkError && (
                      <Alert variant='destructive'>
                        <AlertTriangle className='size-4' />
                        <AlertTitle>No se pudo crear la invitación</AlertTitle>
                        <AlertDescription>{linkError}</AlertDescription>
                      </Alert>
                    )}

                    {inviteLink.data && (
                      <Alert className='border-emerald-500/40 text-emerald-700 dark:text-emerald-400'>
                        <CircleCheck className='size-4' />
                        <AlertTitle>
                          Invitación creada para{' '}
                          {inviteLink.variables?.email ?? 'tu integrante'}
                        </AlertTitle>
                        <AlertDescription>
                          <p className='mb-2'>
                            Comparte este enlace — expira{' '}
                            {formatFechaHora(inviteLink.data.expires_at)}:
                          </p>
                          <span className='flex items-center gap-1'>
                            <Input
                              readOnly
                              value={`${window.location.origin}${inviteLink.data.url}`}
                              aria-label='Enlace de invitación'
                              className='h-8 font-mono text-xs'
                              onFocus={(e) => e.currentTarget.select()}
                            />
                            <CopyButton
                              value={`${window.location.origin}${inviteLink.data.url}`}
                              label='Enlace de invitación'
                              className='size-8'
                            />
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {puedeGestionar && <InvitacionesPendientes tenant={tenant} />}

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Info className='size-4 text-primary' />
                ¿Qué puede hacer cada rol?
              </CardTitle>
              <CardDescription>
                Resumen de la matriz de permisos: el dueño decide quién
                administra y quién atiende.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className='space-y-2.5'>
                <li className='flex flex-wrap items-center gap-2'>
                  <RolChip rol='owner' />
                  <span className='text-sm text-muted-foreground'>
                    Todo — incluidos el dinero (Culqi y el libro de pagos) y los
                    módulos del local.
                  </span>
                </li>
                <li className='flex flex-wrap items-center gap-2'>
                  <RolChip rol='admin' />
                  <span className='text-sm text-muted-foreground'>
                    Equipo, carta y configuración; también pedidos e inbox. Sin
                    dinero ni módulos.
                  </span>
                </li>
                <li className='flex flex-wrap items-center gap-2'>
                  <RolChip rol='staff' />
                  <span className='text-sm text-muted-foreground'>
                    Inbox y pedidos — atiende conversaciones y avanza pedidos.
                  </span>
                </li>
              </ul>
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
            ? `¿Eliminar a ${pendienteEliminar.nombre || pendienteEliminar.email} (${pendienteEliminar.email}, ${ETIQUETA_ROL[pendienteEliminar.rol] ?? pendienteEliminar.rol})? Su cuenta deja de entrar a este local.`
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
