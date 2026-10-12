import { Link } from '@tanstack/react-router'
import {
  Circle,
  CircleCheck,
  Inbox,
  Loader2,
} from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import type { StatusQuery } from './step-datos-app'

/**
 * Paso 3 del wizard: verificación con polling de GET /api/whatsapp
 * (cada 3 s, activo solo en este paso) y checklist visual hasta que Meta
 * confirme el estado "conectado".
 */
export function StepVerificacion({ statusQuery }: { statusQuery: StatusQuery }) {
  const status = statusQuery.data
  const canalListo = Boolean(status?.phone_number_id)
  const webhookListo = Boolean(status?.webhook_url_registrada)
  const conectado = status?.estado === 'conectado'
  const todosListos = canalListo && webhookListo && conectado

  if (statusQuery.isPending) {
    return (
      <Card>
        <CardContent className='space-y-3 py-6'>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-5 w-full' />
          <Skeleton className='h-5 w-3/4' />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Verificación con Meta</CardTitle>
          <CardDescription>
            Consultamos el estado del canal cada 3 segundos — no hace
            falta recargar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className='space-y-3'>
            <ChecklistItem
              listo={canalListo}
              enCurso={!canalListo}
              titulo='Canal con número y token'
              detalle='El phone number ID quedó guardado en tu canal.'
            />
            <ChecklistItem
              listo={webhookListo}
              enCurso={canalListo && !webhookListo}
              titulo='Webhook registrado en Meta'
              detalle='Meta ya sabe a qué URL llamar cuando llegue un mensaje.'
            />
            <ChecklistItem
              listo={conectado}
              enCurso={canalListo && webhookListo && !conectado}
              titulo='Meta confirma la conexión'
              detalle='El estado del canal pasa a "conectado".'
            />
          </ol>
        </CardContent>
      </Card>

      {todosListos ? (
        <Alert className='border-emerald-500/40 text-emerald-700 dark:text-emerald-400'>
          <CircleCheck className='size-4' />
          <AlertTitle>Conectado</AlertTitle>
          <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <span>
              El canal WhatsApp está vivo: los mensajes de clientes caen en
              el Inbox al instante.
            </span>
            <Button asChild size='sm' className='shrink-0 gap-1.5'>
              <Link to='/mensajeria/inbox'>
                <Inbox className='size-4' /> Ir al Inbox
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : status?.estado === 'pausado' ? (
        <Alert className='border-amber-500/40'>
          <AlertTitle>Canal pausado</AlertTitle>
          <AlertDescription>
            El canal está configurado pero en pausa. Reactívalo cuando
            quieras retomar la atención.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Loader2 className='size-4 animate-spin' />
          <AlertTitle>Esperando confirmación de Meta…</AlertTitle>
          <AlertDescription>
            Si en un minuto no cambia a <strong>conectado</strong>, revisa
            que el túnel siga online y reintenta el registro en el paso 2.
            Recuerda: en sandbox, el número de prueba solo puede escribir
            al destinatario QA de tu app.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function ChecklistItem({
  listo,
  enCurso,
  titulo,
  detalle,
}: {
  listo: boolean
  enCurso: boolean
  titulo: string
  detalle: string
}) {
  return (
    <li className='flex items-start gap-3'>
      {listo ? (
        <CircleCheck className='mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400' />
      ) : enCurso ? (
        <Loader2 className='mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground' />
      ) : (
        <Circle className='mt-0.5 size-5 shrink-0 text-muted-foreground/40' />
      )}
      <div>
        <div
          className={
            listo
              ? 'text-sm font-medium'
              : 'text-sm font-medium text-muted-foreground'
          }
        >
          {titulo}
        </div>
        <div className='text-xs text-muted-foreground'>{detalle}</div>
      </div>
    </li>
  )
}
