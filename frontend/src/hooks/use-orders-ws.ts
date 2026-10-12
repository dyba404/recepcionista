import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { WsMessage } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'

export type WsStatus = 'conectando' | 'en vivo' | 'caido'

const BACKOFF_MS = [1_000, 2_000, 5_000] // backoff 1s → 2s → 5s (tope 5s)

/**
 * Suscripción live a WS /ws/orders?token=<jwt> — UNA sola conexión
 * compartida (refcount) entre sidebar, panel, cocina, dashboard e inbox:
 *
 * - order.created | order.updated | demo.reset → invalida ['orders']
 *   (Kanban, KDS y KPIs repintan sin polling).
 * - conversation.updated → invalida ['conversations'] (lista + badge de
 *   no leídos del sidebar).
 * - message.created → invalida ['messages'] (hilo abierto) y
 *   ['conversations'] (last_body / unread).
 *
 * Además del uso como hook (useOrdersWs), el singleton expone
 * `subscribeWsMessages(listener)` para que OTROS consumidores (la campana
 * de notificaciones, contrato horarios-pausa-notif-perfil) reciban los
 * mismos mensajes por fan-out SIN abrir un segundo socket: el listener
 * vive mientras exista la conexión compartida del sidebar.
 *
 * Reconexión con backoff; el estado ('en vivo' / 'caido' / 'conectando')
 * se publica vía useSyncExternalStore para el LiveBadge del header.
 */

// ---- Estado del singleton (módulo) ----
let ws: WebSocket | null = null
let refCount = 0
let disposed = true
let attempt = 0
let reconnectTimer: number | undefined
let queryClient: QueryClient | null = null
let status: WsStatus = 'caido'
const statusListeners = new Set<() => void>()
/** Fan-out de mensajes crudos del WS (campana de notificaciones). */
const messageListeners = new Set<(msg: WsMessage) => void>()

/**
 * Recibe TODOS los mensajes del socket compartido (sin abrir otro).
 * Devuelve la función de limpieza. Los listeners viven a nivel de módulo:
 * la conexión sigue siendo UNA, con refcount de useOrdersWs.
 */
export function subscribeWsMessages(
  listener: (msg: WsMessage) => void
): () => void {
  messageListeners.add(listener)
  return () => {
    messageListeners.delete(listener)
  }
}

function publicarStatus(next: WsStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((listener) => listener())
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

const snapshotStatus = () => status

function handleMessage(ev: MessageEvent) {
  let msg: WsMessage
  try {
    msg = JSON.parse(ev.data as string) as WsMessage
  } catch {
    return // mensaje corrupto: ignorar
  }
  // Fan-out primero: la campana no depende del QueryClient.
  messageListeners.forEach((listener) => listener(msg))
  if (!queryClient) return

  switch (msg.event) {
    case 'order.created':
    case 'order.updated':
    case 'demo.reset':
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      break
    case 'conversation.updated':
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      break
    case 'message.created':
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
      break
  }
}

function connect() {
  if (disposed) return
  const token = useAuthStore.getState().auth.accessToken
  if (!token) {
    // Sin sesión no hay socket: el badge y las páginas asumen 'caido'.
    publicarStatus('caido')
    return
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${window.location.host}/ws/orders?token=${encodeURIComponent(token)}`

  const socket = new WebSocket(url)
  ws = socket

  socket.onopen = () => {
    attempt = 0
    publicarStatus('en vivo')
  }

  socket.onmessage = handleMessage

  socket.onclose = () => {
    // Si este socket ya fue reemplazado (reconnect) o el último
    // consumidor se fue, no programamos reconexiones fantasma.
    if (disposed || socket !== ws) return
    publicarStatus('caido')
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt += 1
    reconnectTimer = window.setTimeout(connect, delay)
  }

  socket.onerror = () => {
    // onclose corre después; ahí programamos la reconexión
    socket.close()
  }
}

export function useOrdersWs(): WsStatus {
  const qc = useQueryClient()

  useEffect(() => {
    queryClient = qc
    refCount += 1
    if (refCount === 1) {
      // Primer consumidor: abre la conexión (token ya validado por la
      // guardia de /_authenticated).
      disposed = false
      attempt = 0
      publicarStatus('conectando')
      connect()
    }

    return () => {
      refCount -= 1
      if (refCount === 0) {
        // Último consumidor fuera: cierra de verdad
        disposed = true
        if (reconnectTimer) window.clearTimeout(reconnectTimer)
        ws?.close()
        ws = null
        publicarStatus('caido')
      }
    }
  }, [qc])

  return useSyncExternalStore(subscribeStatus, snapshotStatus, snapshotStatus)
}
