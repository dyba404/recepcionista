/**
 * Tipos compartidos del contrato backend (docs/adr/0002-auth-websocket-persistencia.md)
 */

export interface AuthUser {
  id: number | string
  email: string
  nombre: string
  tenant_id: string | null
  rol: 'owner' | 'staff' | (string & {})
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer' | (string & {})
  user: AuthUser
}

/** Tenant tal como lo devuelve GET /api/tenants */
export interface Tenant {
  id: string
  nombre: string
  rubro: string
  distrito: string
  delivery: number
  tiempo: string
  yape_qr: string
  culqi_comision: number
  saludo?: string
}

export interface MenuItem {
  id: string
  nombre: string
  desc: string
  cat: string
  precio: number
  disponible: boolean
  foto?: string
}

export interface MenuResponse {
  tenant: { id: string; nombre: string; rubro: string }
  items: MenuItem[]
}

export const ORDER_ESTADOS = [
  'nuevo',
  'confirmado',
  'cocina',
  'delivery',
  'entregado',
] as const

export type OrderEstado = (typeof ORDER_ESTADOS)[number]

export type OrderPago =
  | 'pendiente'
  | 'pendiente_verificar'
  | 'pagado_culqi'
  | 'pagado_yape'
  | 'pagado_culqi_real'

export interface OrderItem {
  id: string
  cant: number
}

export interface Order {
  id: string // "#107"
  tenant: string
  cliente: string
  items: OrderItem[]
  total: number
  estado: OrderEstado
  pago: OrderPago
  direccion?: string
  timeline?: unknown[]
}

/* ============================================================
 * Contrato del chat de cliente (demo) — POST /api/chat y pagos
 * ============================================================ */

/** Línea del carrito que devuelve POST /api/chat (enriquecida). */
export interface ChatCartItem {
  id: string
  nombre: string
  precio: number
  cant: number
}

/** POST /api/chat → respuesta del bot. */
export interface ChatResponse {
  reply: string
  cart: ChatCartItem[]
  /** Solo 'pago' cuando ya hay dirección confirmada. */
  next?: 'pago' | (string & {})
  /** Dirección recordada por cliente (vacía si aún no la dio). */
  direccion?: string
  /** Foto del plato, ej. '/static/img/platos/f1.jpg'. */
  foto?: string
}

/** GET /api/payments/config?tenant= (culqi_pk vacío = simulado). */
export interface PayConfig {
  culqi_pk: string
  yape_qr: string
  tenant: string
}

/** POST /api/payments/culqi/link → link sandbox para el cobro. */
export interface CulqiLink {
  reference_id: string
  url?: string
  monto: number
  comision_est: number
  nota?: string
}

/** POST /api/payments/culqi/webhook → confirmación simulada. */
export interface CulqiWebhookResult {
  ok: boolean
  order: Order
}

/** POST /api/payments/yape → verificación del voucher (monto exacto). */
export interface YapeResult {
  ok: boolean
  estado: OrderPago | (string & {})
  motivo: string
  order: Order
}

/* ============================================================
 * Contrato "modulos-mvp": módulos, WhatsApp, inbox, canned
 * (openspec/changes/modulos-mvp/proposal.md)
 * ============================================================ */

/** GET /api/modules?tenant= → registro de módulos con toggles reales */
export interface ModuleConfig {
  key: string // 'whatsapp' | 'inbox' | 'pagos' | 'kds' | 'carta' | …
  nombre: string
  descripcion: string
  enabled: boolean
  /** True = apagarlo también afecta endpoints del servidor (403) */
  server_gated: boolean
}

/** GET /api/whatsapp/status?tenant= → estado del canal WhatsApp */
export type WhatsAppEstado =
  | 'desconectado'
  | 'conectado'
  | 'pausado'
  | (string & {})

export interface WhatsAppStatus {
  estado: WhatsAppEstado
  phone_number_id: string | null
  verify_token: string | null
  waba_id: string | null
  app_id: string | null
  webhook_url_registrada?: string | null
}

/** Resultado de POST /api/whatsapp/register-webhook (respuesta de Meta) */
export interface WebhookResult {
  ok: boolean
  detalle: string
}

/** GET /api/conversations?tenant= — estados del handoff (patrón Chatwoot) */
export type ConversationEstado = 'bot' | 'humano' | 'resuelta' | (string & {})

export interface Conversation {
  id: string
  tenant_id: string
  canal: string // 'whatsapp' | 'demo' | …
  wa_id: string
  cliente: string
  estado: ConversationEstado
  assigned_to: number | string | null
  assigned_nombre: string | null
  unread: number
  last_message_at: string
  last_body: string
}

export type MessageRole = 'cliente' | 'bot' | 'humano' | 'nota' | (string & {})

/** GET /api/conversations/{id}/messages */
export interface Message {
  id: string
  role: MessageRole
  body: string
  created_at: string
}

/** GET /api/canned?tenant= — respuestas rápidas */
export interface CannedResponse {
  id: string | number
  shortcut: string
  texto: string
}

/** Mensajes que emite WS /ws/orders?token=<jwt> (ADR 0002 + modulos-mvp) */
export type WsEvent =
  | 'order.created'
  | 'order.updated'
  | 'demo.reset'
  | 'conversation.updated'
  | 'message.created'

export interface WsMessage {
  event: WsEvent
  order?: Order
  conversation?: Conversation
  message?: Message
}
