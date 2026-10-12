import { useState } from 'react'
import { isAxiosError } from 'axios'
import {
  Info,
  Lightbulb,
  Lock,
  Pencil,
  PlusCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import type { KnowledgeEntry } from '@/lib/types'
import {
  useCreateKnowledge,
  useKnowledge,
  useRemoveKnowledge,
  useUpdateKnowledge,
} from '@/hooks/use-knowledge'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { EntradaDialog } from './components/entrada-dialog'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de rol. */
function es403Rol(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

/**
 * /configuracion/conocimiento — base de conocimiento del local (contrato
 * carta-inventario-bot, sección B): el "RAG real" del bot. Cada entrada es
 * un tema con su respuesta (horarios, ubicación, promos); las activas se
 * inyectan al prompt y los intents de horario/ubicación responden con su
 * contenido. CRUD completo: crear/editar (Dialog tema* + contenido*),
 * toggle activo en línea (optimista) y eliminar con confirmación. Las
 * mutaciones exigen manage_settings (owner+admin); el staff ve el candado
 * (patrón Equipo/Pagos) y los errores del backend se muestran verbatim.
 */
export function Conocimiento() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  /** manage_settings (matriz roles-equipo): owner+admin; staff ve candado. */
  const puedeGestionar = me?.rol === 'owner' || me?.rol === 'admin'

  const kbQuery = useKnowledge(tenant)
  const create = useCreateKnowledge(tenant)
  const update = useUpdateKnowledge(tenant)
  const remove = useRemoveKnowledge(tenant)

  // Dialog de crear/editar + error verbatim del POST/PATCH
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editando, setEditando] = useState<KnowledgeEntry | null>(null)
  /** Sesión del dialog: cambia al abrir → el form se hidrata de la entrada (remount con key, sin efectos). */
  const [sesionDialog, setSesionDialog] = useState(0)
  const [dialogError, setDialogError] = useState<string | null>(null)
  // Eliminar (ConfirmDialog) + error inline del DELETE
  const [pendienteEliminar, setPendienteEliminar] =
    useState<KnowledgeEntry | null>(null)
  const [eliminarError, setEliminarError] = useState<string | null>(null)
  // Error inline del toggle activo, por id de entrada
  const [toggleError, setToggleError] = useState<{
    id: string | number
    mensaje: string
  } | null>(null)

  const entradas = kbQuery.data ?? []

  function abrirNueva() {
    setEditando(null)
    setDialogError(null)
    setSesionDialog((s) => s + 1)
    setDialogOpen(true)
  }

  function abrirEditar(entrada: KnowledgeEntry) {
    setEditando(entrada)
    setDialogError(null)
    setSesionDialog((s) => s + 1)
    setDialogOpen(true)
  }

  /** Crear o editar según el modo del dialog; error verbatim dentro. */
  function guardarEntrada(vars: { tema: string; contenido: string }) {
    setDialogError(null)
    if (editando) {
      update.mutate(
        { id: editando.id, tema: vars.tema, contenido: vars.contenido },
        {
          onSuccess: () => {
            setDialogOpen(false)
            toast.success('Entrada actualizada', {
              description: 'El bot ya responde con la nueva versión.',
            })
          },
          onError: (err) => {
            setDialogError(apiErrorDetail(err) ?? err.message)
          },
        }
      )
      return
    }
    create.mutate(vars, {
      onSuccess: () => {
        setDialogOpen(false)
        toast.success('Entrada creada', {
          description: `"${vars.tema}" ya está disponible para el bot.`,
        })
      },
      onError: (err) => {
        setDialogError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  /** Toggle activo en línea (optimista con rollback en el hook). */
  function toggleActivo(entrada: KnowledgeEntry, activo: boolean) {
    setToggleError(null)
    update.mutate(
      { id: entrada.id, activo },
      {
        onSuccess: () => {
          toast.success(
            activo
              ? `"${entrada.tema}" activada — el bot la usa.`
              : `"${entrada.tema}" pausada — el bot la ignora.`
          )
        },
        onError: (err) => {
          setToggleError({
            id: entrada.id,
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
        toast.success('Entrada eliminada')
      },
      onError: (err) => {
        setEliminarError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  const dialogPending = editando ? update.isPending : create.isPending

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
              Base de conocimiento
            </h1>
            <p className='max-w-2xl text-muted-foreground'>
              El bot responde horarios, ubicación y promociones desde aquí.
              Carga una entrada por tema y actívala para que el bot la use.
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
              Nueva entrada
            </Button>
            <Button
              variant='outline'
              size='icon'
              aria-label='Refrescar entradas'
              disabled={kbQuery.isPending}
              onClick={() => void kbQuery.refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </div>

        {kbQuery.isError &&
          (isModuleDisabledError(kbQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(kbQuery.error)} />
          ) : es403Rol(kbQuery.error) ? (
            <Alert>
              <Lock className='size-4' />
              <AlertTitle>
                Solo el dueño o un administrador pueden ver esto
              </AlertTitle>
              <AlertDescription>
                Consultar la base de conocimiento requiere rol de dueño o
                administrador. Pídele al dueño del local que cargue los datos.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo cargar la base de conocimiento</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(kbQuery.error) ?? kbQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void kbQuery.refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <div className='mx-auto w-full max-w-3xl'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Lightbulb className='size-4 text-primary' />
                Entradas del local
              </CardTitle>
              <CardDescription>
                Una por tema: "Horarios", "Ubicación", "Promociones"… Las
                entradas pausadas no entran al prompt del bot.
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
                    Editar la base de conocimiento requiere rol de dueño o
                    administrador (manage_settings). Pídele al dueño del local
                    que cargue o actualice los datos.
                  </AlertDescription>
                </Alert>
              )}

              {kbQuery.isPending && (
                <div className='space-y-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </div>
              )}

              {!kbQuery.isPending && !kbQuery.isError && (
                <div className='overflow-hidden rounded-lg border'>
                  <Table>
                    <TableHeader className='bg-muted/50'>
                      <TableRow>
                        <TableHead>Entrada</TableHead>
                        <TableHead className='w-28'>Activo</TableHead>
                        <TableHead className='w-56'>Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entradas.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className='h-20 text-center text-muted-foreground'
                          >
                            Sin entradas todavía. Agrega "Horarios" o
                            "Promociones" para que el bot las sepa.
                          </TableCell>
                        </TableRow>
                      )}
                      {entradas.map((entrada) => (
                        <TableRow key={String(entrada.id)}>
                          <TableCell>
                            <div className='font-medium'>
                              {entrada.tema}
                              {!entrada.activo && (
                                <Badge variant='outline' className='ms-2'>
                                  Pausada
                                </Badge>
                              )}
                            </div>
                            <div className='line-clamp-2 max-w-xl text-sm text-muted-foreground'>
                              {entrada.contenido}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className='space-y-1'>
                              <Switch
                                checked={entrada.activo}
                                aria-label={`Activar ${entrada.tema}`}
                                disabled={
                                  !puedeGestionar ||
                                  (update.isPending &&
                                    update.variables?.id === entrada.id)
                                }
                                onCheckedChange={(checked) =>
                                  toggleActivo(entrada, checked)
                                }
                              />
                              {toggleError?.id === entrada.id && (
                                <p
                                  role='alert'
                                  className='text-xs font-medium text-destructive'
                                >
                                  {toggleError.mensaje}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              <Button
                                variant='outline'
                                size='sm'
                                className='gap-1.5'
                                disabled={!puedeGestionar}
                                onClick={() => abrirEditar(entrada)}
                              >
                                <Pencil className='size-3.5' />
                                Editar
                              </Button>
                              <Button
                                variant='outline'
                                size='sm'
                                aria-label={`Eliminar ${entrada.tema}`}
                                className='gap-1.5 text-destructive hover:text-destructive'
                                disabled={
                                  !puedeGestionar ||
                                  (remove.isPending &&
                                    pendienteEliminar?.id === entrada.id)
                                }
                                onClick={() => {
                                  setPendienteEliminar(entrada)
                                  setEliminarError(null)
                                }}
                              >
                                <Trash2 className='size-3.5' />
                                Eliminar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <Alert>
                <Info className='size-4' />
                <AlertTitle>Cómo las usa el bot</AlertTitle>
                <AlertDescription>
                  Las entradas activas entran al prompt como "INFORMACIÓN DEL
                  LOCAL": si preguntan por horario o ubicación, el bot responde
                  con el contenido de la entrada correspondiente; sin entrada
                  cargada responde con honestidad en vez de inventar.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </Main>

      <EntradaDialog
        key={sesionDialog}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false)
            setDialogError(null)
          }
        }}
        entrada={editando}
        onSubmit={guardarEntrada}
        isPending={dialogPending}
        serverError={dialogError}
      />

      <ConfirmDialog
        open={pendienteEliminar !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendienteEliminar(null)
            setEliminarError(null)
          }
        }}
        title='Eliminar entrada'
        desc={
          pendienteEliminar
            ? `¿Eliminar "${pendienteEliminar.tema}"? El bot deja de responder con esta información de inmediato.`
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
