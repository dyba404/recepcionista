import { useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import {
  AlertTriangle,
  Clock,
  DoorClosed,
  DoorOpen,
  Lock,
  RefreshCw,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail } from '@/lib/api'
import type { HorarioDia } from '@/lib/types'
import {
  DIAS_SEMANA,
  horarioValido,
  useHorarios,
  useSaveHorarios,
} from '@/hooks/use-horarios'
import { useCurrentTenant } from '@/hooks/use-modules'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de rol. */
function es403Rol(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

/** Rellena a 7 filas Lun..Dom (0..6) por si el backend viene incompleto. */
function normalizar(dias: HorarioDia[] | undefined): HorarioDia[] {
  const base = Array.from({ length: 7 }, (_, dia): HorarioDia => ({
    dia,
    activo: true,
    apertura: '12:00',
    cierre: '22:00',
  }))
  for (const d of dias ?? []) {
    if (d.dia >= 0 && d.dia < 7) base[d.dia] = { ...base[d.dia], ...d }
  }
  return base
}

/**
 * /configuracion/horarios (contrato horarios-pausa-notif-perfil, A — patrón
 * Chatwoot working hours): badge grande de estado actual (ABIERTO/CERRADO
 * con el mensaje_estado del backend) + tabla Lun..Dom con switch de día
 * activo y horas apertura/cierre. PATCH /api/horarios bulk al guardar
 * (manage_settings: owner+admin; staff ve candado). Validación client de
 * apertura<cierre inline por fila.
 */
export function Horarios() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  /** manage_settings (matriz roles-equipo): owner+admin; staff ve candado. */
  const puedeGestionar = me?.rol === 'owner' || me?.rol === 'admin'

  const horariosQuery = useHorarios(tenant)
  const save = useSaveHorarios(tenant)

  const [dias, setDias] = useState<HorarioDia[]>(() => normalizar(undefined))
  const [formError, setFormError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** true cuando el GET ya llenó la tabla (no pisar lo que edita el dueño). */
  const hydrated = useRef(false)

  // Hidratar la tabla UNA vez con lo del backend (patrón Asistente).
  useEffect(() => {
    const data = horariosQuery.data
    if (data && !hydrated.current) {
      hydrated.current = true
      setDias(normalizar(data.dias))
    }
  }, [horariosQuery.data])

  function actualizar(dia: number, cambios: Partial<HorarioDia>) {
    setDias((prev) =>
      prev.map((d) => (d.dia === dia ? { ...d, ...cambios } : d))
    )
  }

  function guardar() {
    setFormError(null)
    setSaveError(null)
    const invalido = dias.find((d) => !horarioValido(d))
    if (invalido) {
      setFormError(
        `${DIAS_SEMANA[invalido.dia]}: la apertura debe ser antes del cierre.`
      )
      return
    }
    save.mutate(dias, {
      onSuccess: () => {
        toast.success('Horario guardado', {
          description: 'El bot ya responde según los nuevos horarios.',
        })
      },
      onError: (err) => {
        setSaveError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  const deshabilitado = !puedeGestionar || horariosQuery.isPending || save.isPending
  const estado = horariosQuery.data

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
              Horarios de atención
            </h1>
            <p className='max-w-2xl text-muted-foreground'>
              Define cuándo atiende el local. Fuera de horario el bot avisa
              honestamente que está cerrado y nunca toma el pedido; la carta,
              el tracking y la ubicación siguen disponibles.
            </p>
          </div>
        </div>

        {horariosQuery.isError && es403Rol(horariosQuery.error) && (
          <Alert>
            <Lock className='size-4' />
            <AlertTitle>
              Solo el dueño o un administrador pueden ver esto
            </AlertTitle>
            <AlertDescription>
              Consultar los horarios requiere rol de dueño o administrador.
              Pídele al dueño del local que los ajuste.
            </AlertDescription>
          </Alert>
        )}

        {horariosQuery.isError && !es403Rol(horariosQuery.error) && (
          <Alert variant='destructive'>
            <AlertTitle>No se pudo cargar el horario</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>
                {apiErrorDetail(horariosQuery.error) ??
                  horariosQuery.error.message}
              </span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void horariosQuery.refetch()}
                className='gap-1.5'
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {horariosQuery.isPending && (
          <div className='space-y-2'>
            <Skeleton className='h-16 w-72 rounded-xl' />
            <Skeleton className='h-80 w-full rounded-xl' />
          </div>
        )}

        {estado && (
          <div className='mx-auto w-full max-w-3xl space-y-4'>
            {/* Estado actual según hora local (calculado por el backend). */}
            <Card className='border-2'>
              <CardContent className='flex flex-wrap items-center gap-4 py-6'>
                <Badge
                  className={`gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold ${
                    estado.abierto_ahora
                      ? 'border-transparent bg-emerald-600 text-white'
                      : 'border-transparent bg-red-600 text-white'
                  }`}
                >
                  {estado.abierto_ahora ? (
                    <DoorOpen className='size-4' />
                  ) : (
                    <DoorClosed className='size-4' />
                  )}
                  {estado.abierto_ahora ? 'ABIERTO' : 'CERRADO'}
                </Badge>
                <p className='text-sm font-medium'>{estado.mensaje_estado}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Clock className='size-4 text-primary' />
                  Horario semanal
                </CardTitle>
                <CardDescription>
                  Desactiva un día (feriado) o ajusta sus horas. Aplica al
                  chat del bot en cuanto guardas.
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {!puedeGestionar && (
                  <Alert>
                    <Lock className='size-4' />
                    <AlertTitle>
                      Solo el dueño o un administrador pueden hacer esto
                    </AlertTitle>
                    <AlertDescription>
                      Editar los horarios requiere rol de dueño o
                      administrador (manage_settings). Pídele al dueño del
                      local que los ajuste.
                    </AlertDescription>
                  </Alert>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Atiende</TableHead>
                      <TableHead>Apertura</TableHead>
                      <TableHead>Cierre</TableHead>
                      <TableHead className='sr-only'>Validación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dias.map((d) => {
                      const invalido = d.activo && !horarioValido(d)
                      return (
                        <TableRow key={d.dia}>
                          <TableCell className='font-medium'>
                            {DIAS_SEMANA[d.dia]}
                          </TableCell>
                          <TableCell>
                            <Switch
                              aria-label={`Atiende el ${DIAS_SEMANA[d.dia]}`}
                              checked={d.activo}
                              disabled={deshabilitado}
                              onCheckedChange={(activo) =>
                                actualizar(d.dia, { activo })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Label
                              className='sr-only'
                              htmlFor={`apertura-${d.dia}`}
                            >
                              Apertura {DIAS_SEMANA[d.dia]}
                            </Label>
                            <Input
                              id={`apertura-${d.dia}`}
                              type='time'
                              value={d.apertura}
                              disabled={deshabilitado || !d.activo}
                              onChange={(e) =>
                                actualizar(d.dia, { apertura: e.target.value })
                              }
                              aria-invalid={invalido || undefined}
                              className='w-28'
                            />
                          </TableCell>
                          <TableCell>
                            <Label
                              className='sr-only'
                              htmlFor={`cierre-${d.dia}`}
                            >
                              Cierre {DIAS_SEMANA[d.dia]}
                            </Label>
                            <Input
                              id={`cierre-${d.dia}`}
                              type='time'
                              value={d.cierre}
                              disabled={deshabilitado || !d.activo}
                              onChange={(e) =>
                                actualizar(d.dia, { cierre: e.target.value })
                              }
                              aria-invalid={invalido || undefined}
                              className='w-28'
                            />
                          </TableCell>
                          <TableCell
                            className={
                              invalido
                                ? 'text-xs text-destructive'
                                : 'text-xs text-muted-foreground'
                            }
                          >
                            {invalido && 'La apertura debe ser antes del cierre'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                <Button
                  className='gap-1.5'
                  onClick={guardar}
                  disabled={deshabilitado}
                >
                  {save.isPending ? (
                    <RefreshCw className='size-4 animate-spin' />
                  ) : (
                    <Save className='size-4' />
                  )}
                  {save.isPending ? 'Guardando…' : 'Guardar horario'}
                </Button>

                {(saveError || formError) && (
                  <Alert variant='destructive'>
                    <AlertTriangle className='size-4' />
                    <AlertTitle>No se pudo guardar el horario</AlertTitle>
                    <AlertDescription>
                      {saveError ?? formError}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </Main>
    </>
  )
}
