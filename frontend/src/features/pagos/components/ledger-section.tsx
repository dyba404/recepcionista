import { useState } from 'react'
import { isAxiosError } from 'axios'
import { Link } from '@tanstack/react-router'
import { Download, Lock, ReceiptText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import { csvErrorDetail, descargarCsv } from '@/lib/csv-download'
import { formatFechaHora } from '@/lib/datetime'
import { penFormatter } from '@/lib/order-utils'
import type { LedgerEntry, LedgerEstado } from '@/lib/types'
import { ModuleDisabled } from '@/components/module-disabled'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLedger } from '@/hooks/use-payments-ledger'

const GATEWAY_LABEL: Record<string, string> = {
  culqi_real: 'Culqi (real)',
  culqi_simulado: 'Culqi (simulado)',
  yape: 'Yape',
}

function EstadoBadge({ estado }: { estado: LedgerEstado }) {
  if (estado === 'verificado') {
    return <Badge className='bg-emerald-600 text-white'>Verificado</Badge>
  }
  if (estado === 'rechazado') {
    return <Badge variant='destructive'>Rechazado</Badge>
  }
  if (estado === 'pendiente_verificar') {
    return (
      <Badge
        variant='outline'
        className='border-amber-500/40 text-amber-700 dark:text-amber-400'
      >
        Pendiente de verificar
      </Badge>
    )
  }
  return <Badge variant='outline'>{estado}</Badge>
}

/**
 * "Pagos del local" (contrato saas-cola-2): ledger con los últimos 100
 * pagos — una fila por cada acción de pago, con el pedido linkeado al
 * panel, monto en es-PE y estado con color. Solo owner: el staff ve el
 * candado cuando el backend responde 403 al ledger.
 */
export function LedgerSection({ tenant }: { tenant: string }) {
  const ledgerQuery = useLedger(tenant)
  const entries = ledgerQuery.data ?? []

  // Exportar CSV (contrato endurecer-local): GET /api/reports/ledger.csv
  // (view_ledger — el botón solo aparece si el ledger cargó).
  const [descargandoCsv, setDescargandoCsv] = useState(false)

  async function exportarCsv() {
    setDescargandoCsv(true)
    try {
      await descargarCsv(
        '/api/reports/ledger.csv',
        { tenant },
        `ledger-${tenant}.csv`
      )
      toast.success('Pagos exportados', {
        description: 'CSV con BOM UTF-8 — ábrelo directo en Excel.',
      })
    } catch (err) {
      toast.error('No se pudo exportar el CSV', {
        description:
          (await csvErrorDetail(err)) ??
          'Revisa que el backend esté arriba e inténtalo de nuevo.',
      })
    } finally {
      setDescargandoCsv(false)
    }
  }

  return (
    <Card id='pagos-del-local'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <ReceiptText className='size-4 text-primary' />
          Pagos del local
        </CardTitle>
        <CardDescription>
          Cada cobro queda registrado por el servidor — tarjeta real,
          simulado o Yape — con su verificación. Últimos 100.
        </CardDescription>
        {!ledgerQuery.isError && (
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  className='gap-1.5'
                  disabled={descargandoCsv}
                  onClick={() => void exportarCsv()}
                >
                  {descargandoCsv ? (
                    <RefreshCw className='size-3.5 animate-spin' />
                  ) : (
                    <Download className='size-3.5' />
                  )}
                  {descargandoCsv ? 'Exportando…' : 'Exportar CSV'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Últimos 100 pagos</TooltipContent>
            </Tooltip>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className='space-y-4'>
        {ledgerQuery.isPending && (
          <div className='space-y-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        )}

        {ledgerQuery.isError &&
          (isModuleDisabledError(ledgerQuery.error) ? (
            <ModuleDisabled detail={apiErrorDetail(ledgerQuery.error)} />
          ) : isAxiosError(ledgerQuery.error) &&
            ledgerQuery.error.response?.status === 403 ? (
            <Alert>
              <Lock className='size-4' />
              <AlertTitle>Solo el dueño puede ver los pagos</AlertTitle>
              <AlertDescription>
                El historial de cobros del local requiere rol owner. Pídele al
                dueño que lo revise desde aquí.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo cargar el historial de pagos</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(ledgerQuery.error) ??
                    ledgerQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  onClick={() => void ledgerQuery.refetch()}
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        {!ledgerQuery.isPending && !ledgerQuery.isError && (
          <div className='overflow-hidden rounded-lg border'>
            <Table>
              <TableHeader className='bg-muted/50'>
                <TableRow>
                  <TableHead>Pasarela</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead className='text-end'>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className='w-36'>Fecha y hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className='h-20 text-center text-muted-foreground'
                    >
                      Sin pagos registrados todavía. Cuando el chat de cliente
                      cobre (Culqi o Yape), cada pago aparece aquí.
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((entry: LedgerEntry) => (
                  <TableRow key={String(entry.id)}>
                    <TableCell className='whitespace-nowrap'>
                      {GATEWAY_LABEL[entry.gateway] ?? entry.gateway}
                    </TableCell>
                    <TableCell>
                      <Button
                        asChild
                        variant='link'
                        size='sm'
                        className='h-auto p-0 font-mono'
                      >
                        <Link to='/panel' search={{ tenant }}>
                          {entry.order_id}
                        </Link>
                      </Button>
                    </TableCell>
                    <TableCell className='text-end font-medium tabular-nums'>
                      {penFormatter.format(entry.monto)}
                    </TableCell>
                    <TableCell>
                      <EstadoBadge estado={entry.estado} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {formatFechaHora(entry.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
