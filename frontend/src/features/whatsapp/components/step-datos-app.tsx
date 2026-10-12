import { Info } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { useWhatsAppStatus } from '@/hooks/use-whatsapp'
import { CopyButton } from './copy-button'

export type StatusQuery = ReturnType<typeof useWhatsAppStatus>

/**
 * Paso 1 del wizard: qué hacer en Meta for Developers + los datos de la
 * app (app_id, waba_id, verify_token) con botón copiar. Copys honestos:
 * el sandbox solo puede chatear con el destinatario QA.
 */
export function StepDatosApp({ statusQuery }: { statusQuery: StatusQuery }) {
  const status = statusQuery.data

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Cómo funciona</CardTitle>
          <CardDescription>
            Meta Cloud API oficial — tres pasos y tu local contesta por
            WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className='list-decimal space-y-2 ps-5 text-sm'>
            <li>
              En{' '}
              <a
                href='https://developers.facebook.com/apps'
                target='_blank'
                rel='noreferrer'
                className='font-medium underline underline-offset-4'
              >
                Meta for Developers
              </a>{' '}
              crea una app de tipo <em>Business</em> y agrégale el producto
              WhatsApp.
            </li>
            <li>
              Copia el <strong>verify token</strong> de abajo en la
              configuración del webhook de tu app (Meta lo valida en cada
              llamada).
            </li>
            <li>
              Conecta el número de prueba y registra el webhook en el{' '}
              <strong>paso 2</strong> de este asistente.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos de tu app</CardTitle>
          <CardDescription>
            Pégalos tal cual en Meta — son los de este tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <DatoApp
            label='App ID'
            valor={status?.app_id ?? ''}
            isPending={statusQuery.isPending}
          />
          <DatoApp
            label='WABA ID (cuenta de WhatsApp Business)'
            valor={status?.waba_id ?? ''}
            isPending={statusQuery.isPending}
          />
          <DatoApp
            label='Verify token (webhook)'
            valor={status?.verify_token ?? ''}
            isPending={statusQuery.isPending}
          />
        </CardContent>
      </Card>

      <Alert className='border-sky-500/40'>
        <Info className='size-4 text-sky-600 dark:text-sky-400' />
        <AlertTitle>Sandbox honesto</AlertTitle>
        <AlertDescription>
          Con el <strong>número de prueba</strong> de Meta solo puedes
          escribir al destinatario QA registrado en tu app (tú). Para
          conversar con clientes reales necesitas un número propio aprobado
          por Meta.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function DatoApp({
  label,
  valor,
  isPending,
}: {
  label: string
  valor: string
  isPending: boolean
}) {
  return (
    <div className='flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2'>
      <div className='min-w-0 flex-1'>
        <div className='text-xs text-muted-foreground'>{label}</div>
        {isPending ? (
          <Skeleton className='h-5 w-40' />
        ) : (
          <div className='truncate font-mono text-sm'>
            {valor || (
              <span className='text-muted-foreground'>
                — aún no disponible —
              </span>
            )}
          </div>
        )}
      </div>
      {!isPending && <CopyButton value={valor} label={label} />}
    </div>
  )
}
