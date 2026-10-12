import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  Info,
  Lock,
  MessageSquareText,
  PlusCircle,
  RefreshCw,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import type { WATemplate } from '@/lib/types'
import {
  useCreatePlantilla,
  useEnviarPruebaPlantilla,
  usePlantillas,
} from '@/hooks/use-plantillas'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CrearPlantillaDialog } from './components/crear-plantilla-dialog'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de rol. */
function es403Rol(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

/**
 * Estado de la plantilla con color (contrato endurecer-local): aprobada
 * emerald / en_revision ámbar / rechazada roja / local muted. Cualquier
 * otro estado (Meta en test devuelve p.ej. PENDING_APPROVAL) se muestra
 * tal cual en muted — honestidad del contrato "estado según respuesta".
 */
function EstadoPlantillaBadge({ estado }: { estado: string }) {
  if (estado === 'aprobada') {
    return <Badge className='bg-emerald-600 text-white'>Aprobada</Badge>
  }
  if (estado === 'en_revision') {
    return (
      <Badge
        variant='outline'
        className='border-amber-500/40 text-amber-700 dark:text-amber-400'
      >
        En revisión
      </Badge>
    )
  }
  if (estado === 'rechazada') {
    return <Badge variant='destructive'>Rechazada</Badge>
  }
  if (estado === 'local') {
    return <Badge variant='outline'>Local</Badge>
  }
  return (
    <Badge variant='outline' className='text-muted-foreground'>
      {estado}
    </Badge>
  )
}

/** Chip de categoría de Meta (MARKETING / UTILITY / AUTHENTICATION). */
function CategoriaChip({ categoria }: { categoria: string }) {
  if (categoria === 'MARKETING') {
    return <Badge variant='outline'>Marketing</Badge>
  }
  if (categoria === 'UTILITY') {
    return <Badge variant='outline'>Utilidad</Badge>
  }
  if (categoria === 'AUTHENTICATION') {
    return <Badge variant='outline'>Autenticación</Badge>
  }
  return <Badge variant='outline'>{categoria}</Badge>
}

/**
 * /configuracion/plantillas (contrato endurecer-local, sección D): las
 * plantillas de WhatsApp con las que el negocio INICIA conversaciones
 * (promos, avisos de pedido listo…). GET hace el merge espejo local + Meta
 * (best effort); "Enviar prueba" manda la plantilla al número de test de
 * Meta y el resultado/error se muestra verbatim; crear dispara el POST a
 * Meta con el estado que devuelva. Requiere manage_settings (owner+admin):
 * el staff ve el candado (patrón Equipo/Pagos/Conocimiento).
 */
export function Plantillas() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  /** manage_settings (matriz roles-equipo): owner+admin; staff ve candado. */
  const puedeGestionar = me?.rol === 'owner' || me?.rol === 'admin'

  const plantillasQuery = usePlantillas(tenant)
  const create = useCreatePlantilla(tenant)
  const enviarPrueba = useEnviarPruebaPlantilla(tenant)

  const [dialogOpen, setDialogOpen] = useState(false)
  /** Sesión del dialog: cambia al abrir → el form arranca limpio (remount). */
  const [sesionDialog, setSesionDialog] = useState(0)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const plantillas = plantillasQuery.data ?? []

  function abrirNueva() {
    setDialogError(null)
    setSesionDialog((s) => s + 1)
    setDialogOpen(true)
  }

  /** POST a Meta + espejo local; el error del backend va inline verbatim. */
  function crearPlantilla(vars: {
    nombre: string
    categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
    lenguaje: 'es' | 'en'
    cuerpo: string
  }) {
    setDialogError(null)
    create.mutate(vars, {
      onSuccess: (data) => {
        setDialogOpen(false)
        toast.success(`Plantilla "${vars.nombre}" creada`, {
          description: data?.estado
            ? `Meta la dejó como: ${data.estado} — la tabla lo muestra tal cual.`
            : 'Meta la recibió — el estado aparece en la tabla.',
        })
      },
      onError: (err) => {
        setDialogError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  /** Enviar prueba por fila: toast con el resultado o el error de Meta. */
  function enviar(t: WATemplate) {
    enviarPrueba.mutate(
      { nombre: t.nombre, lenguaje: t.lenguaje },
      {
        onSuccess: (res) => {
          if (res && res.ok === false) {
            toast.error(`Meta rechazó la prueba de "${t.nombre}"`, {
              description: res.detalle ?? 'Revisa el estado de la plantilla.',
            })
          } else {
            toast.success(`Prueba de "${t.nombre}" enviada`, {
              description:
                res?.detalle ??
                'Meta la envió al número de test del sandbox.',
            })
          }
        },
        onError: (err) => {
          toast.error('No se pudo enviar la prueba', {
            description: apiErrorDetail(err) ?? err.message,
          })
        },
      }
    )
  }

  /** Fila en envío: la mutation en vuelo pertenece a esta plantilla. */
  function filaEnviando(t: WATemplate): boolean {
    return (
      enviarPrueba.isPending &&
      enviarPrueba.variables?.nombre === t.nombre &&
      enviarPrueba.variables?.lenguaje === t.lenguaje
    )
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
              Plantillas
            </h1>
            <p className='max-w-2xl text-muted-foreground'>
              Los mensajes que inicia tu negocio — promos, avisos de pedido
              listo — se envían con plantillas de WhatsApp. Créalas aquí y
              Meta las aprueba.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              onClick={abrirNueva}
              disabled={!puedeGestionar}
              className='gap-1.5'
            >
              {puedeGestionar ? (
                <PlusCircle className='size-4' />
              ) : (
                <Lock className='size-4' />
              )}
              Nueva plantilla
            </Button>
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar plantillas'
              disabled={plantillasQuery.isPending}
              onClick={() => void plantillasQuery.refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {plantillasQuery.isError &&
          (isModuleDisabledError(plantillasQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(plantillasQuery.error)} />
          ) : es403Rol(plantillasQuery.error) ? (
            <Alert>
              <Lock className='size-4' />
              <AlertTitle>
                Solo el dueño o un administrador pueden ver esto
              </AlertTitle>
              <AlertDescription>
                Consultar las plantillas requiere rol de dueño o
                administrador (manage_settings). Pídele al dueño del local
                que las revise desde aquí.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudieron cargar las plantillas</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(plantillasQuery.error) ??
                    plantillasQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void plantillasQuery.refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <div className='mx-auto w-full max-w-4xl'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <MessageSquareText className='size-4 text-primary' />
                Plantillas del local
              </CardTitle>
              <CardDescription>
                El espejo local junto con las de Meta (si Graph responde, se
                traen también las del WABA). El estado es el que Meta
                devuelve — en el sandbox puede quedarse en revisión.
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
                    Crear y probar plantillas requiere rol de dueño o
                    administrador (manage_settings). Pídele al dueño del
                    local que las gestione desde aquí.
                  </AlertDescription>
                </Alert>
              )}

              {plantillasQuery.isPending && (
                <div className='space-y-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </div>
              )}

              {!plantillasQuery.isPending && !plantillasQuery.isError && (
                <div className='overflow-hidden rounded-lg border'>
                  <Table>
                    <TableHeader className='bg-muted/50'>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className='w-32'>Categoría</TableHead>
                        <TableHead className='w-16'>Lenguaje</TableHead>
                        <TableHead className='w-32'>Estado</TableHead>
                        <TableHead className='w-36'>Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plantillas.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className='h-20 text-center text-muted-foreground'
                          >
                            Sin plantillas todavía. Crea una para enviar
                            promos y avisos — en el sandbox de Meta ya viene
                            hello_world pre-aprobada para probar.
                          </TableCell>
                        </TableRow>
                      )}
                      {plantillas.map((t) => (
                        <TableRow key={String(t.id)}>
                          <TableCell>
                            <div className='font-mono text-sm'>{t.nombre}</div>
                            <div className='line-clamp-1 max-w-sm text-xs text-muted-foreground'>
                              {t.cuerpo}
                            </div>
                          </TableCell>
                          <TableCell>
                            <CategoriaChip categoria={t.categoria} />
                          </TableCell>
                          <TableCell className='text-muted-foreground'>
                            {t.lenguaje}
                          </TableCell>
                          <TableCell>
                            <EstadoPlantillaBadge estado={t.estado} />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant='outline'
                              size='sm'
                              className='gap-1.5'
                              disabled={!puedeGestionar || filaEnviando(t)}
                              onClick={() => enviar(t)}
                            >
                              {filaEnviando(t) ? (
                                <RefreshCw className='size-3.5 animate-spin' />
                              ) : (
                                <Send className='size-3.5' />
                              )}
                              {filaEnviando(t) ? 'Enviando…' : 'Enviar prueba'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <Alert>
                <Info className='size-4' />
                <AlertTitle>
                  Cómo funciona el envío en el sandbox
                </AlertTitle>
                <AlertDescription>
                  Los mensajes que INICIA el negocio requieren plantillas
                  aprobadas por Meta; en producción usa tu número real. Las
                  pruebas se envían por Graph al número de test del
                  sandbox — el resultado (o el rechazo de Meta) se muestra
                  tal cual.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </Main>

      <CrearPlantillaDialog
        key={sesionDialog}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false)
            setDialogError(null)
          }
        }}
        onSubmit={crearPlantilla}
        isPending={create.isPending}
        serverError={dialogError}
      />
    </>
  )
}
