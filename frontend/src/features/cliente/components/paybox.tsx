import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  RefreshCw,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api, apiErrorDetail } from '@/lib/api'
import { penFormatter } from '@/lib/order-utils'
import type {
  CulqiChargeResult,
  CulqiLink,
  CulqiWebhookResult,
  Order,
  YapeResult,
} from '@/lib/types'
import { usePayConfig } from '@/hooks/use-pay-config'
import { useTenants } from '@/hooks/use-tenants'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { CHECKOUT_CERRADO, abrirCheckoutCulqi } from '../culqi-checkout'

export interface PayboxProps {
  tenant: string
  /** Pedido creado con los ítems del carrito. */
  order: Order
  /** Link de Culqi sandbox creado para el pedido. */
  link: CulqiLink
  /** Burbuja del lado cliente ("Pago con Culqi", "Te mando mi voucher…"). */
  onCliente: (text: string) => void
  /** Burbuja del bot; `panel` añade el link a /panel. */
  onBot: (text: string, panel?: string) => void
  /** Indicador "escribiendo…" mientras viaja el POST. */
  onTyping: (on: boolean) => void
}

/**
 * Paybox del simulador (cuando el bot responde next='pago'): crea la orden
 * y el link de Culqi, muestra el QR de Yape con el monto exacto y los
 * caminos de pago (contrato pasarela-culqi):
 * - Con llaves (GET /api/payments/config → culqi_pk NO vacío): botón
 *   primario "Pagar con tarjeta (Culqi)" que abre el checkout REAL
 *   (culqi.js v4 por CDN), espera el token y cobra con
 *   POST /api/payments/culqi/charge.
 * - Sin llaves: SOLO el botón Culqi SIMULADO (webhook) con la nota
 *   honesta, más el QR de Yape — Yape exacto ✓ y Yape falso ✗ (monto
 *   -10, para probar la regla anti-fraude). Copys del legacy
 *   static/chat.html.
 */
export function Paybox({
  tenant,
  order,
  link,
  onCliente,
  onBot,
  onTyping,
}: PayboxProps) {
  const [pagado, setPagado] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    mensaje: string
    reintentar: () => void
  } | null>(null)
  const configQuery = usePayConfig(tenant)
  const config = configQuery.data
  const tenantsQuery = useTenants()

  /** Con llaves públicas (culqi_pk no vacío) hay checkout de tarjeta REAL. */
  const culqiPk = config?.culqi_pk ?? ''
  const hayCulqiReal = culqiPk.length > 0

  /** Nombre del local para el título del checkout de Culqi. */
  const nombreLocal =
    tenantsQuery.data?.find((t) => t.id === tenant)?.nombre ?? tenant

  /** Checkout REAL (culqi.js v4): token del iframe → cargo en el servidor. */
  async function pagarTarjetaReal() {
    if (!culqiPk) return
    onCliente('Pago con tarjeta')
    setBusy(true)
    setError(null)
    onTyping(true)
    try {
      const token = await abrirCheckoutCulqi({
        publicKey: culqiPk,
        title: nombreLocal,
        total: order.total,
      })
      const res = await api.post<CulqiChargeResult>(
        '/api/payments/culqi/charge',
        { order_id: order.id, token: token.id }
      )
      onTyping(false)
      if (res.data.ok) {
        onBot(
          `✓ Cargo verificado por Culqi: ${res.data.charge_id} — ${res.data.order.id} a cocina`,
          res.data.order.id
        )
        setPagado(true)
      } else {
        onBot(
          `Culqi no aprobó el cargo: ${res.data.motivo || 'revisa la tarjeta e inténtalo de nuevo, o usa Yape.'}`
        )
      }
    } catch (err) {
      onTyping(false)
      const mensaje = err instanceof Error ? err.message : ''
      if (mensaje === CHECKOUT_CERRADO) {
        onBot('Checkout cerrado sin completar — usa Yape o el simulado.')
      } else {
        const motivo = apiErrorDetail(err) ?? (mensaje || 'inténtalo de nuevo')
        onBot(
          `El checkout de Culqi no se pudo completar (${motivo}). Usa Yape o el cobro simulado.`
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function pagarCulqi() {
    onCliente('Pago con Culqi')
    setBusy(true)
    setError(null)
    onTyping(true)
    try {
      const res = await api.post<CulqiWebhookResult>(
        '/api/payments/culqi/webhook',
        { reference_id: link.reference_id }
      )
      onTyping(false)
      onBot(
        `✓ Pago verificado — ${res.data.order.id} a cocina, míralo en Panel.`,
        res.data.order.id
      )
      setPagado(true)
    } catch (err) {
      onTyping(false)
      setError({
        mensaje:
          apiErrorDetail(err) ??
          'El cobro falló. Genera el cobro de nuevo o usa Yape.',
        reintentar: pagarCulqi,
      })
    } finally {
      setBusy(false)
    }
  }

  async function pagarYape(exacto: boolean) {
    onCliente('Te mando mi voucher Yape')
    setBusy(true)
    setError(null)
    onTyping(true)
    // Yape falso: monto -10 para probar la verificación anti-fraude.
    const monto = exacto ? order.total : Math.max(order.total - 10, 0)
    try {
      const res = await api.post<YapeResult>('/api/payments/yape', {
        order_id: order.id,
        monto_foto: monto,
      })
      onTyping(false)
      if (res.data.ok) {
        onBot(
          `✓ Pago verificado — ${res.data.order.id} a cocina (${res.data.motivo}).`,
          res.data.order.id
        )
        setPagado(true)
      } else {
        onBot(
          `✗ Monto no coincide — posible voucher falso. ${res.data.motivo} Pide una foto nítida del voucher o cobra con Culqi.`
        )
      }
    } catch (err) {
      onTyping(false)
      setError({
        mensaje:
          apiErrorDetail(err) ??
          'No se pudo verificar el voucher. Inténtalo de nuevo.',
        reintentar: () => pagarYape(exacto),
      })
    } finally {
      setBusy(false)
    }
  }

  const qrValue = config
    ? `https://yape.pe/pay/${encodeURIComponent(config.yape_qr)}?monto=${order.total.toFixed(2)}`
    : ''

  return (
    <Card className='gap-0 overflow-hidden pt-0'>
      {/* Barra tipo "terminal de cobro" (legacy term-bar) */}
      <CardHeader className='flex flex-row items-center gap-2 border-b bg-muted/60 px-6 py-2.5'>
        <span className='flex gap-1' aria-hidden>
          <span className='size-2 rounded-full bg-primary/40' />
          <span className='size-2 rounded-full bg-primary/55' />
          <span className='size-2 rounded-full bg-primary/70' />
        </span>
        <CardTitle className='font-mono text-xs font-normal tracking-wide text-muted-foreground'>
          cobro {order.id} ·{' '}
          <span className='font-semibold text-foreground tabular-nums'>
            {penFormatter.format(order.total)}
          </span>{' '}
          · a {order.direccion || 'sin dirección'}
        </CardTitle>
      </CardHeader>

      <CardContent className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className='gap-1 font-mono'>
            ref <b>{link.reference_id}</b>
          </Badge>
          <Badge variant='outline' className='tabular-nums'>
            comisión <b>{penFormatter.format(link.comision_est)}</b>
          </Badge>
        </div>

        {/* QR de Yape con el monto exacto */}
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
          {config ? (
            <div className='shrink-0 rounded-lg border bg-white p-2'>
              <QRCodeSVG value={qrValue} size={124} />
            </div>
          ) : configQuery.isError ? (
            <Alert variant='destructive' className='sm:w-32'>
              <AlertDescription className='flex flex-col gap-2'>
                <span className='text-xs'>QR no disponible</span>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  onClick={() => void configQuery.refetch()}
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <Skeleton className='size-[140px] shrink-0 rounded-lg' />
          )}
          <div className='min-w-0'>
            <p className='text-sm font-semibold'>Yape QR del local</p>
            <p className='font-mono text-xs text-muted-foreground'>
              código {config?.yape_qr ?? '…'} · monto exacto{' '}
              <b className='tabular-nums'>{penFormatter.format(order.total)}</b>
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              QR demo escaneable: solo pasa a cocina el monto EXACTO verificado
              por el servidor. La foto del voucher nunca basta.
            </p>
          </div>
        </div>

        {pagado ? (
          <div className='flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2'>
            <span className='flex items-center gap-1.5 text-sm font-medium text-primary'>
              <CheckCircle2 className='size-4' /> Pago verificado — {order.id}
            </span>
            <Button asChild size='sm' variant='outline'>
              <Link to='/panel' search={{ tenant }}>
                Míralo en el Panel
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <Separator />
            <div className='flex flex-wrap gap-2'>
              {/* Mientras carga la config no sabemos si hay checkout real:
                  el slot del botón primario queda en skeleton. */}
              {configQuery.isPending ? (
                <Skeleton className='h-9 w-48' />
              ) : hayCulqiReal ? (
                <Button
                  disabled={busy}
                  onClick={() => void pagarTarjetaReal()}
                  className='gap-1.5'
                >
                  <CreditCard className='size-4' />
                  Pagar con tarjeta (Culqi)
                </Button>
              ) : null}
              <Button
                variant={hayCulqiReal ? 'outline' : 'default'}
                disabled={busy}
                onClick={() => void pagarCulqi()}
              >
                Culqi (SIMULADO)
              </Button>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void pagarYape(true)}
              >
                Yape exacto ✓
              </Button>
              <Button
                variant='destructive'
                disabled={busy}
                onClick={() => void pagarYape(false)}
              >
                Yape falso ✗
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              {hayCulqiReal
                ? 'El pago con tarjeta abre el checkout de Culqi y crea un cargo real que el servidor verifica contra la API de Culqi.'
                : '(el pago con tarjeta real requiere llaves; usa el simulado)'}
              {link.nota ? ` — ${link.nota}` : ''}
            </p>
          </>
        )}

        {error && (
          <Alert variant='destructive'>
            <AlertTriangle className='size-4' />
            <AlertTitle>El cobro falló</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>{error.mensaje}</span>
              <Button
                size='sm'
                variant='outline'
                className='gap-1.5'
                disabled={busy}
                onClick={error.reintentar}
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
