import { useState } from 'react'
import { CheckCircle2, Lock, RefreshCw, XCircle, Zap } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
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
import { apiErrorDetail } from '@/lib/api'
import type { WebhookResult } from '@/lib/types'
import {
  useConectarTodo,
  useRegisterWebhook,
  useWhatsAppSetup,
} from '@/hooks/use-whatsapp'
import { CanalEstadoBadge } from './canal-estado-badge'
import type { StatusQuery } from './step-datos-app'

/**
 * Paso 2 del wizard: estado del canal (badge por color) + conectar número
 * (POST /api/whatsapp/setup, owner) + registrar el webhook en Meta con la
 * URL pública del túnel (POST /api/whatsapp/register-webhook) y mostrar
 * el resultado tal como lo devolvió Meta.
 */
const ETIQUETAS_PASOS: Record<string, string> = {
  canal: 'Canal del local',
  suscripcion: 'Suscripción whatsapp_business_account + messages',
  limpieza: 'Suscripción vieja (object=whatsapp) eliminada',
  subscribed_apps: 'WABA suscrito a esta app',
  verificacion: 'Verificación contra lo que Meta tiene registrado',
}

export function StepCanal({
  statusQuery,
  tenant,
  isOwner,
}: {
  statusQuery: StatusQuery
  tenant: string
  isOwner: boolean
}) {
  const status = statusQuery.data
  const setup = useWhatsAppSetup(tenant)
  const registerWebhook = useRegisterWebhook(tenant)
  const conectarTodo = useConectarTodo(tenant)

  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [token, setToken] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')

  const resultadoWebhook: WebhookResult | null =
    registerWebhook.data ??
    (registerWebhook.isError
      ? {
          ok: false,
          detalle:
            apiErrorDetail(registerWebhook.error) ??
            'No se pudo contactar al backend para registrar el webhook.',
        }
      : null)

  return (
    <div className='space-y-4'>
      {!isOwner && (
        <Alert>
          <Lock className='size-4' />
          <AlertTitle>Solo el dueño puede hacer esto</AlertTitle>
          <AlertDescription>
            Conectar el canal y registrar el webhook requieren rol owner.
            Pídele al dueño del local que complete este paso.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Estado del canal</CardTitle>
          <CardDescription>
            Así ve tu local al canal WhatsApp ahora mismo.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {statusQuery.isPending ? (
            <div className='space-y-2'>
              <Skeleton className='h-6 w-32' />
              <Skeleton className='h-4 w-64' />
            </div>
          ) : (
            <>
              <div className='flex items-center gap-3'>
                <CanalEstadoBadge estado={status?.estado} />
                <span className='text-sm text-muted-foreground'>
                  {status?.estado === 'conectado'
                    ? 'El canal responde a mensajes.'
                    : status?.estado === 'pausado'
                      ? 'El canal está vivo pero pausado.'
                      : 'El canal aún no habla con Meta.'}
                </span>
              </div>
              <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                <div>
                  <dt className='text-xs text-muted-foreground'>
                    Phone Number ID
                  </dt>
                  <dd className='truncate font-mono'>
                    {status?.phone_number_id || '— sin conectar —'}
                  </dd>
                </div>
                <div>
                  <dt className='text-xs text-muted-foreground'>
                    Webhook registrado
                  </dt>
                  <dd className='truncate font-mono'>
                    {status?.webhook_url_registrada || '— sin registrar —'}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Zap className='size-4 text-primary' />
            Conectar todo de un clic
          </CardTitle>
          <CardDescription>
            Ejecuta la secuencia completa con Meta: suscripción con el objeto
            correcto (whatsapp_business_account) + campo messages, limpieza de
            la suscripción vieja, WABA suscrito a la app y verificación final.
            Si algo ya está hecho, simplemente lo confirma (idempotente).
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Button
            disabled={!isOwner || conectarTodo.isPending}
            onClick={() => conectarTodo.mutate(callbackUrl.trim() || undefined)}
            className='gap-1.5'
          >
            {conectarTodo.isPending ? (
              <RefreshCw className='size-4 animate-spin' />
            ) : (
              <Zap className='size-4' />
            )}
            {conectarTodo.isPending ? 'Conectando…' : 'Conectar todo'}
          </Button>
          <p className='text-xs text-muted-foreground'>
            Sin URL usa el túnel configurado en el backend. Puedes pegar una
            callback URL distinta abajo y usarla para la conexión.
          </p>

          {conectarTodo.data && (
            <ul className='space-y-1.5 text-sm'>
              {conectarTodo.data.pasos.map((paso) => (
                <li
                  key={paso.paso}
                  className='flex items-start gap-2'
                >
                  {paso.ok ? (
                    <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-emerald-600' />
                  ) : (
                    <XCircle className='mt-0.5 size-4 shrink-0 text-destructive' />
                  )}
                  <span>
                    <b className='font-medium'>
                      {ETIQUETAS_PASOS[paso.paso] ?? paso.paso}
                    </b>
                    {' — '}
                    <span className='text-muted-foreground'>{paso.detalle}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {conectarTodo.data && !conectarTodo.data.ok && (
            <Alert variant='destructive'>
              <AlertTitle>La conexión quedó incompleta</AlertTitle>
              <AlertDescription>
                Corrige el paso en rojo (el detalle es el error tal como lo
                devolvió Meta) y vuelve a pulsar Conectar todo.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conectar número (avanzado)</CardTitle>
          <CardDescription>
            Pega los datos del número de prueba de tu app Meta. Con solo
            uno de los dos ya se puede intentar la conexión.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='wa-phone-number-id'>Phone Number ID</Label>
            <Input
              id='wa-phone-number-id'
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder='123456789012345'
              autoComplete='off'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='wa-token'>Token de acceso (access token)</Label>
            <Input
              id='wa-token'
              type='password'
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder='EAAG…'
              autoComplete='off'
            />
            <p className='text-xs text-muted-foreground'>
              En sandbox usa el token temporal de la app; en producción, un
              token de sistema permanente.
            </p>
          </div>
          <Button
            disabled={
              !isOwner ||
              setup.isPending ||
              (!phoneNumberId.trim() && !token.trim())
            }
            onClick={() =>
              setup.mutate({
                phoneNumberId: phoneNumberId.trim(),
                token: token.trim(),
              })
            }
            className='gap-1.5'
          >
            {setup.isPending && (
              <RefreshCw className='size-4 animate-spin' />
            )}
            Conectar canal
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registrar webhook en Meta</CardTitle>
          <CardDescription>
            La URL pública de tu túnel (ngrok, Cloudflare Tunnel…) que
            expone el webhook del backend.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='wa-callback'>Callback URL (pública)</Label>
            <Input
              id='wa-callback'
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder='https://mi-tunel.ejemplo.com/api/whatsapp/webhook'
              inputMode='url'
              autoComplete='off'
            />
            <p className='text-xs text-muted-foreground'>
              Debe ser https y alcanzable desde internet; Meta la llama en
              cada mensaje entrante.
            </p>
          </div>
          <Button
            disabled={
              !isOwner ||
              registerWebhook.isPending ||
              !callbackUrl.trim() ||
              !/^https?:\/\//i.test(callbackUrl.trim())
            }
            onClick={() => registerWebhook.mutate(callbackUrl.trim())}
            className='gap-1.5'
          >
            {registerWebhook.isPending && (
              <RefreshCw className='size-4 animate-spin' />
            )}
            Registrar webhook en Meta
          </Button>

          {resultadoWebhook && (
            <Alert
              variant={resultadoWebhook.ok ? 'default' : 'destructive'}
              className={
                resultadoWebhook.ok
                  ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                  : undefined
              }
            >
              <AlertTitle>
                {resultadoWebhook.ok
                  ? 'Meta respondió OK'
                  : 'Meta rechazó el registro'}
              </AlertTitle>
              <AlertDescription>
                {resultadoWebhook.detalle}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
