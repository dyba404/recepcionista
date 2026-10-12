import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useOrdersWs, subscribeWsMessages } from '@/hooks/use-orders-ws'
import { ESTADO_LABEL, penFormatter } from '@/lib/order-utils'
import type { Order, WsMessage } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationsStore } from '@/stores/notifications-store'

/**
 * Campana de notificaciones (contrato horarios-pausa-notif-perfil, C):
 * se monta UNA vez en el AuthenticatedLayout y escucha los mismos
 * mensajes del WS SIN duplicar sockets:
 *
 * 1. `useOrdersWs()` suma +1 al refcount del singleton que ya monta el
 *    sidebar — la conexión física sigue siendo UNA para toda la app.
 * 2. `subscribeWsMessages(listener)` engancha un fan-out módulo-nivel al
 *    `handleMessage` de ese mismo socket (ver use-orders-ws.ts).
 *
 * Qué genera notificación (solo eventos del tenant actual):
 * - order.created → "Nuevo pedido #N — S/ X" (+toast).
 * - order.updated con pago pagado_* → "Pago verificado #N" (+toast).
 * - order.updated con pago pendiente_verificar → "Posible voucher falso
 *   en #N" tipo fraude (+toast).
 * - order.updated con estado distinto al último visto → "Pedido #N pasó
 *   a {estado}".
 * - message.created role=cliente → "Mensaje de {cliente}" (sin toast: no
 *   spamear; el badge de la campana ya avisa).
 *
 * El filtro por tenant es estricto: order.tenant / message.tenant_id
 * deben coincidir con el de la sesión (el backend broadcastea a todos los
 * locales conectados). Un message sin tenant_id (backend viejo) se ignora
 * — fail-closed: mejor perder una notificación que mostrar el pedido de
 * otro local.
 */

/** Última foto conocida por pedido (dedupe de order.updated). */
const seen = new Map<string, { estado: string; pago: string }>()

let seq = 0
function nextId(): string {
  seq += 1
  return `notif-${Date.now()}-${seq}`
}

function esPagoVerificado(pago: string): boolean {
  return pago.startsWith('pagado')
}

export function useNotifications(): void {
  const router = useRouter()
  // Refcount del socket compartido: lo mantiene vivo durante TODA la
  // sesión autenticada (no solo mientras exista el sidebar).
  useOrdersWs()

  useEffect(() => {
    const push = useNotificationsStore.getState().push

    function onOrder(order: Order, creado: boolean) {
      const prev = seen.get(order.id)
      seen.set(order.id, { estado: order.estado, pago: order.pago })

      // Pedido avistado por primera vez vía order.created → alta.
      if (!prev && creado) {
        push({
          id: nextId(),
          tipo: 'pedido',
          texto: `Nuevo pedido ${order.id} — ${penFormatter.format(order.total)}`,
          ruta: '/panel',
          createdAt: new Date().toISOString(),
        })
        toast(`Nuevo pedido ${order.id}`, {
          description: `${order.cliente} — ${penFormatter.format(order.total)}`,
          action: {
            label: 'Ver',
            onClick: () => void router.navigate({ to: '/panel' }),
          },
        })
        return
      }

      // Update de un pedido nunca visto (recarga/reconexión): nace
      // "pendiente", así que un pago/fraude SÍ dispara notificación;
      // el avance de estado no (no hay foto previa con qué comparar).
      const pagoAntes = prev?.pago ?? 'pendiente'
      const pagoAhora = String(order.pago)

      // Un mismo update puede cambiar pago y estado: prioriza fraude,
      // luego pago verificado, luego el avance (nunca dos por evento).
      if (pagoAhora === 'pendiente_verificar' && pagoAntes !== pagoAhora) {
        push({
          id: nextId(),
          tipo: 'fraude',
          texto: `Posible voucher falso en ${order.id} — pendiente de verificar`,
          ruta: '/panel',
          createdAt: new Date().toISOString(),
        })
        toast.error(`Posible voucher falso en ${order.id}`, {
          description: 'El pago quedó pendiente de verificar.',
          action: {
            label: 'Ver',
            onClick: () => void router.navigate({ to: '/panel' }),
          },
        })
        return
      }

      if (esPagoVerificado(pagoAhora) && !esPagoVerificado(pagoAntes)) {
        push({
          id: nextId(),
          tipo: 'pago',
          texto: `Pago verificado ${order.id}`,
          ruta: '/panel',
          createdAt: new Date().toISOString(),
        })
        toast.success(`Pago verificado ${order.id}`, {
          action: {
            label: 'Ver',
            onClick: () => void router.navigate({ to: '/panel' }),
          },
        })
        return
      }

      if (prev && order.estado !== prev.estado) {
        push({
          id: nextId(),
          tipo: 'estado',
          texto: `Pedido ${order.id} pasó a ${ESTADO_LABEL[order.estado] ?? order.estado}`,
          ruta: '/panel',
          createdAt: new Date().toISOString(),
        })
      }
    }

    function onMessage(msg: WsMessage) {
      const tenantId = useAuthStore.getState().auth.user?.tenant_id
      if (!tenantId) return

      switch (msg.event) {
        case 'order.created':
        case 'order.updated': {
          const order = msg.order
          if (!order || order.tenant !== tenantId) return
          onOrder(order, msg.event === 'order.created')
          break
        }
        case 'message.created': {
          const message = msg.message
          // tenant_id es la clave del filtro (contrato): sin él no se
          // muestra nada (fail-closed).
          if (!message || message.tenant_id !== tenantId) return
          if (message.role !== 'cliente') return
          push({
            id: nextId(),
            tipo: 'mensaje',
            texto: `Mensaje de ${message.cliente || 'cliente'}`,
            ruta: '/inbox',
            createdAt: new Date().toISOString(),
          })
          break
        }
        case 'demo.reset':
          // Los ids vuelven a nacer: soltar el dedupe de estados.
          seen.clear()
          break
        default:
          break
      }
    }

    return subscribeWsMessages(onMessage)
  }, [router])
}
