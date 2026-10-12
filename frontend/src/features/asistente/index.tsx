import { useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import {
  AlertTriangle,
  Bot,
  Lock,
  PauseCircle,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { formatFechaHora } from '@/lib/datetime'
import {
  esTonoValido,
  useBotConfig,
  usePauseBot,
  useSaveBotConfig,
} from '@/hooks/use-botconfig'
import { useCurrentTenant } from '@/hooks/use-modules'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

/** ¿El error es un 403 que no es "módulo desactivado"? → candado de rol. */
function es403Rol(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 403
}

const MAX_INSTRUCCIONES = 800

/** Los tres tonos del contrato (Literal del backend), con su descripción. */
const TONOS = [
  {
    value: 'cercano',
    etiqueta: 'Cercano',
    descripcion: 'como caserito peruano',
  },
  {
    value: 'formal',
    etiqueta: 'Formal',
    descripcion: 'formal pero cálido',
  },
  {
    value: 'divertido',
    etiqueta: 'Divertido',
    descripcion: 'humor ligero',
  },
] as const

/**
 * /configuracion/asistente — bot configurable (contrato
 * carta-inventario-bot, sección C): nombre, saludo, tono (3 RadioCards) e
 * instrucciones extra (máx 800, con contador). GET /api/botconfig al
 * cargar → PUT /api/botconfig al guardar (manage_settings) → toast de
 * éxito; el error del backend se muestra verbatim. Las REGLAS DE SEGURIDAD
 * del bot (anti-fraude, sin prometer cocina) son fijas: nota honesta y
 * jamás editables. El staff ve el candado (patrón Equipo/Pagos).
 *
 * Arriba de todo vive el switch "Asistente pausado" (contrato
 * horarios-pausa-notif-perfil, B): PATCH /api/botconfig {pausado} con
 * actualización optimista + rollback (usePauseBot).
 */
export function Asistente() {
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  /** manage_settings (matriz roles-equipo): owner+admin; staff ve candado. */
  const puedeGestionar = me?.rol === 'owner' || me?.rol === 'admin'

  const configQuery = useBotConfig(tenant)
  const save = useSaveBotConfig(tenant)
  const pause = usePauseBot(tenant)

  const [nombreBot, setNombreBot] = useState('')
  const [saludo, setSaludo] = useState('')
  const [tono, setTono] = useState<'cercano' | 'formal' | 'divertido'>(
    'cercano'
  )
  const [instrucciones, setInstrucciones] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** true cuando el GET ya llenó el form (no pisar lo que teclea el dueño). */
  const hydrated = useRef(false)

  // Hidratar el form UNA vez con la configuración del backend; si el GET
  // refresca después, lo que el dueño esté editando manda.
  useEffect(() => {
    const cfg = configQuery.data
    if (cfg && !hydrated.current) {
      hydrated.current = true
      setNombreBot(cfg.nombre_bot ?? '')
      setSaludo(cfg.saludo ?? '')
      setTono(esTonoValido(cfg.tono) ? cfg.tono : 'cercano')
      setInstrucciones(cfg.instrucciones_extra ?? '')
    }
  }, [configQuery.data])

  function guardar() {
    setFormError(null)
    setSaveError(null)
    const nombreLimpio = nombreBot.trim()
    if (!nombreLimpio) {
      setFormError('Escribe el nombre del bot, ej. "FaroBot".')
      return
    }
    const saludoLimpio = saludo.trim()
    if (!saludoLimpio) {
      setFormError('Escribe el saludo con el que abre la conversación.')
      return
    }
    if (instrucciones.length > MAX_INSTRUCCIONES) {
      // La textarea ya lo corta con maxLength — por si llega pegado/truncado.
      setFormError(
        `Las instrucciones no pueden pasar de ${MAX_INSTRUCCIONES} caracteres.`
      )
      return
    }
    save.mutate(
      {
        nombre_bot: nombreLimpio,
        saludo: saludoLimpio,
        tono,
        instrucciones_extra: instrucciones.trim(),
        // El PUT completo reenvía la pausa actual para no reactivar el
        // bot por accidente al guardar la personalidad (contrato B).
        pausado: configQuery.data?.pausado ?? false,
      },
      {
        onSuccess: () => {
          toast.success('Asistente actualizado', {
            description: `El bot ya atiende como "${nombreLimpio}" con el tono elegido.`,
          })
        },
        onError: (err) => {
          setSaveError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  const config = configQuery.data
  const deshabilitado =
    !puedeGestionar || configQuery.isPending || save.isPending

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
              Asistente
            </h1>
            <p className='max-w-2xl text-muted-foreground'>
              Configura cómo habla tu bot: su nombre, el saludo con el que abre
              la conversación, el tono y tus instrucciones. El bot los usa al
              atender el chat de cliente.
            </p>
          </div>
          {config?.updated_at && (
            <span className='text-xs text-muted-foreground'>
              Última actualización: {formatFechaHora(config.updated_at)}
            </span>
          )}
        </div>

        {configQuery.isError &&
          (isModuleDisabledError(configQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(configQuery.error)} />
          ) : es403Rol(configQuery.error) ? (
            <Alert>
              <Lock className='size-4' />
              <AlertTitle>
                Solo el dueño o un administrador pueden ver esto
              </AlertTitle>
              <AlertDescription>
                Consultar la configuración del bot requiere rol de dueño o
                administrador. Pídele al dueño del local que la ajuste.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>
                No se pudo cargar la configuración del bot
              </AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(configQuery.error) ??
                    configQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => void configQuery.refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <div className='mx-auto w-full max-w-3xl space-y-4'>
          {/* Pausa del bot (contrato B, auto-responder out-of-office):
              switch grande arriba de todo, optimista + rollback. */}
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <PauseCircle className='size-4 text-primary' />
                Estado del asistente
              </CardTitle>
              <CardDescription>
                Pausa total: el bot no responde nada (ni carta ni horarios);
                los mensajes caen al Inbox y el equipo contesta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {configQuery.isPending ? (
                <Skeleton className='h-12 w-64' />
              ) : (
                <div className='flex items-center gap-4'>
                  <Switch
                    aria-label='Asistente pausado'
                    checked={config?.pausado ?? false}
                    disabled={!puedeGestionar || pause.isPending}
                    onCheckedChange={(pausado) => pause.mutate(pausado)}
                    className='h-7 w-12 [&_[data-slot=switch-thumb]]:size-6 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[calc(100%-4px)]'
                  />
                  <div>
                    <p
                      className={`text-base font-bold ${
                        config?.pausado
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {config?.pausado ? 'Pausado' : 'Activo'}
                    </p>
                    <p className='text-sm text-muted-foreground'>
                      {config?.pausado
                        ? 'El bot no responde; los mensajes caen al Inbox y el equipo contesta.'
                        : 'El bot atiende el chat de cliente con la configuración de abajo.'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Bot className='size-4 text-primary' />
                Personalidad del bot
              </CardTitle>
              <CardDescription>
                Los cambios aplican al chat de cliente en cuanto guardas.
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
                    Configurar el asistente requiere rol de dueño o
                    administrador (manage_settings). Pídele al dueño del local
                    que lo ajuste.
                  </AlertDescription>
                </Alert>
              )}

              {configQuery.isPending ? (
                <div className='space-y-2'>
                  <Skeleton className='h-10 w-56' />
                  <Skeleton className='h-16 w-full' />
                  <Skeleton className='h-28 w-full' />
                </div>
              ) : (
                <form
                  className='space-y-4'
                  onSubmit={(e) => {
                    e.preventDefault()
                    guardar()
                  }}
                >
                  <div className='space-y-2'>
                    <Label htmlFor='bot-nombre'>
                      Nombre del bot <span className='text-destructive'>*</span>
                    </Label>
                    <Input
                      id='bot-nombre'
                      value={nombreBot}
                      onChange={(e) => setNombreBot(e.target.value)}
                      placeholder='Ej. FaroBot'
                      disabled={deshabilitado}
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='bot-saludo'>
                      Saludo <span className='text-destructive'>*</span>
                    </Label>
                    <Textarea
                      id='bot-saludo'
                      value={saludo}
                      onChange={(e) => setSaludo(e.target.value)}
                      placeholder={
                        'Ej. ¡Hola! Soy FaroBot, tu casero de confianza. ¿Qué se te antoja hoy?'
                      }
                      rows={2}
                      className='min-h-16'
                      disabled={deshabilitado}
                    />
                    <p className='text-xs text-muted-foreground'>
                      Es lo primero que el bot dice en el chat (y lo que
                      acompaña la carta cuando la envía).
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label>Tono</Label>
                    <RadioGroup
                      value={tono}
                      onValueChange={(v) => {
                        if (esTonoValido(v)) setTono(v)
                      }}
                      disabled={deshabilitado}
                      className='grid gap-3 sm:grid-cols-3'
                    >
                      {TONOS.map((t) => (
                        <label
                          key={t.value}
                          htmlFor={`tono-${t.value}`}
                          className={`flex items-start gap-3 rounded-lg border p-4 transition-colors has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 ${
                            deshabilitado
                              ? 'cursor-not-allowed opacity-50'
                              : 'cursor-pointer'
                          }`}
                        >
                          <RadioGroupItem
                            value={t.value}
                            id={`tono-${t.value}`}
                            className='mt-0.5'
                          />
                          <span>
                            <span className='block font-medium'>
                              {t.etiqueta}
                            </span>
                            <span className='block text-xs text-muted-foreground'>
                              {t.descripcion}
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                      <Label htmlFor='bot-instrucciones'>
                        Instrucciones extra
                      </Label>
                      <span className='text-xs text-muted-foreground tabular-nums'>
                        {instrucciones.length}/{MAX_INSTRUCCIONES}
                      </span>
                    </div>
                    <Textarea
                      id='bot-instrucciones'
                      value={instrucciones}
                      maxLength={MAX_INSTRUCCIONES}
                      onChange={(e) => setInstrucciones(e.target.value)}
                      placeholder={
                        'Ej. Recomienda el tiradito cuando pidan algo nikkei\nEj. Los lunes 2x1 en pollos'
                      }
                      rows={4}
                      aria-invalid={Boolean(saveError)}
                      disabled={deshabilitado}
                    />
                    <p className='text-xs text-muted-foreground'>
                      Se añaden al prompt del bot SIN contradecir sus reglas:
                      promociones, platos que quieres empujar, cómo atender
                      ciertas preguntas.
                    </p>
                  </div>

                  <Alert>
                    <ShieldCheck className='size-4' />
                    <AlertTitle>Las reglas del bot no se cambian</AlertTitle>
                    <AlertDescription>
                      Las reglas de seguridad del bot (verificación de pagos, no
                      prometer cocina) no se pueden cambiar.
                    </AlertDescription>
                  </Alert>

                  <Button
                    type='submit'
                    className='gap-1.5'
                    disabled={deshabilitado}
                  >
                    {save.isPending ? (
                      <RefreshCw className='size-4 animate-spin' />
                    ) : (
                      <Save className='size-4' />
                    )}
                    {save.isPending ? 'Guardando…' : 'Guardar asistente'}
                  </Button>

                  {(saveError || formError) && (
                    <Alert variant='destructive'>
                      <AlertTriangle className='size-4' />
                      <AlertTitle>
                        No se pudo guardar la configuración
                      </AlertTitle>
                      <AlertDescription>
                        {saveError ?? formError}
                      </AlertDescription>
                    </Alert>
                  )}
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
