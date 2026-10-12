/**
 * Tipos compartidos del contrato backend (docs/adr/0002-auth-websocket-persistencia.md)
 */

/**
 * Roles del equipo (contrato roles-equipo, patrón Chatwoot): owner (dueño,
 * creador del negocio), admin (administrador) y staff (operativo).
 * `(string & {})` mantiene compatibilidad con backends viejos en vivo.
 */
export type RolEquipo = 'owner' | 'admin' | 'staff' | (string & {})

export interface AuthUser {
  id: number | string
  email: string
  nombre: string
  tenant_id: string | null
  rol: RolEquipo
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
  /**
   * Contrato endurecer-local (planes del SaaS): plan vigente del local.
   * Opcional porque un backend viejo en vivo no lo trae.
   */
  plan?: 'trial' | 'basico' | 'pro' | (string & {})
  /** Fin de la prueba (ISO) — llega con plan trial (opcional por lo mismo). */
  trial_hasta?: string | null
}

export interface MenuItem {
  id: string
  nombre: string
  desc: string
  cat: string
  precio: number
  disponible: boolean
  foto?: string
  /**
   * Contrato carta-inventario-bot: unidades disponibles del plato.
   * null (o ausente, backends viejos) = ilimitado; NUNCA negativo.
   * stock==0 se muestra como "AGOTADO" aunque disponible siga en true.
   */
  stock?: number | null
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

/**
 * GET /api/payments/config?tenant= (culqi_pk vacío = simulado).
 * Contrato pasarela-culqi: culqi_estado dice si el chat cobra con tarjeta
 * real ("conectada" por cuenta del local o "simulada" por .env) y
 * culqi_pk_enmascarada enseña la llave pública con la que se cobra.
 */
export interface PayConfig {
  culqi_pk: string
  culqi_pk_enmascarada?: string | null
  culqi_estado?: 'conectada' | 'simulada' | (string & {})
  yape_qr: string
  /**
   * true = el local subió su QR real de Yape (GET /api/tenants/{id}/qr lo
   * sirve); el paybox lo muestra en vez del QR generado. Opcional porque
   * un backend viejo en vivo no lo trae.
   */
  yape_qr_imagen?: boolean
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
 * Contrato "pasarela-culqi": cuenta de Culqi del local + cargo real
 * ============================================================ */

/** Estado de la cuenta de la pasarela (femenino: la cuenta/conexión). */
export type PaymentsEstado = 'desconectada' | 'conectada' | (string & {})

/** GET /api/payments/cuenta?tenant= (Bearer) — cuenta del local. */
export interface PaymentsAccount {
  estado: PaymentsEstado
  /** Llave pública ENMASCARADA ("pk_test_…1234") — nunca la completa. */
  public_key: string | null
  /** Cuándo validó Culqi las llaves por última vez (ISO). */
  verified_at: string | null
  /** Proveedor de la pasarela ("culqi"). */
  provider: string
}

/**
 * POST /api/payments/culqi/charge {order_id, token} → cargo REAL con
 * tarjeta, verificado por el servidor contra la API de Culqi.
 */
export interface CulqiChargeResult {
  ok: boolean
  /** Id del cargo en Culqi ("chr_…") — presente en la rama ok. */
  charge_id: string
  /** Motivo del rechazo tal como lo devuelve Culqi (cuando !ok). */
  motivo: string
  order: Order
}

/* ============================================================
 * Contrato "saas-cola-2": registro con negocio, staff y ledger
 * (openspec/changes/saas-cola-2/proposal.md)
 * ============================================================ */

/** GET /api/staff?tenant= (owner/admin) → integrantes del local. */
export interface StaffMember {
  id: number | string
  email: string
  nombre: string
  rol: RolEquipo
}

/** Estado de una fila del ledger de pagos (verificado por el servidor). */
export type LedgerEstado =
  'verificado' | 'rechazado' | 'pendiente_verificar' | (string & {})

/**
 * GET /api/payments/ledger?tenant= (owner) → últimos 100 pagos. Una fila
 * por cada acción de pago (cargo Culqi real, webhook simulado, Yape).
 */
export interface LedgerEntry {
  id: string | number
  tenant_id: string
  order_id: string
  gateway: 'culqi_real' | 'culqi_simulado' | 'yape' | (string & {})
  referencia: string | null
  monto: number
  comision: number
  estado: LedgerEstado
  detalle: string | null
  created_at: string
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
  'desconectado' | 'conectado' | 'pausado' | (string & {})

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
  /**
   * Solo en el payload WS message.created (contrato
   * horarios-pausa-notif-perfil): tenant emisor y nombre del cliente,
   * para que la campana filtre por tenant actual.
   */
  tenant_id?: string
  cliente?: string
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

/* ============================================================
 * Contrato "carta-inventario-bot": base de conocimiento y bot
 * configurable (openspec/changes/carta-inventario-bot/proposal.md)
 * ============================================================ */

/**
 * GET /api/kb?tenant= — entrada de la base de conocimiento del local
 * (horarios, ubicación, promos). El bot inyecta las activas al prompt;
 * el intent de horario/ubicación responde su contenido.
 */
export interface KnowledgeEntry {
  id: string | number
  tenant_id?: string
  tema: string
  contenido: string
  /** false = el bot la ignora (no entra al prompt ni a los intents). */
  activo: boolean
  created_at?: string
}

/** Tono del bot (Literal del backend; `(string & {})` tolera backends viejos). */
export type BotTono = 'cercano' | 'formal' | 'divertido' | (string & {})

/**
 * GET /api/botconfig?tenant= / PUT /api/botconfig {tenant, …}
 * (manage_settings). instrucciones_extra máx 800 chars (422 si excede);
 * las reglas de seguridad del bot NO viven aquí — son fijas.
 */
export interface BotConfig {
  nombre_bot: string
  saludo: string
  tono: BotTono
  instrucciones_extra: string
  /**
   * Contrato horarios-pausa-notif-perfil (auto-responder out-of-office):
   * true = el bot no responde; los mensajes caen al Inbox y contesta el
   * equipo. Opcional porque un backend viejo en vivo no lo trae.
   */
  pausado?: boolean
  updated_at?: string
}

/* ============================================================
 * Contrato "horarios-pausa-notif-perfil": horarios de atención,
 * pausa del bot, notificaciones y perfil editable
 * (openspec/changes/horarios-pausa-notif-perfil/proposal.md)
 * ============================================================ */

/**
 * Horario de UN día de la semana (patrón Chatwoot working hours).
 * dia: 0=Lunes .. 6=Domingo; apertura/cierre "HH:MM" (hora local Lima).
 */
export interface HorarioDia {
  id?: number | string
  dia: number // 0=Lunes .. 6=Domingo
  activo: boolean
  apertura: string // "HH:MM"
  cierre: string // "HH:MM"
}

/**
 * GET /api/horarios?tenant= (Bearer) → las 7 filas (Lun..Dom) + el estado
 * actual calculado por el backend según hora local:
 * abierto_ahora ("Abierto — cierra a las 22:00" / "Cerrado — abre el
 * lunes a las 12:00"…).
 */
export interface HorariosResp {
  dias: HorarioDia[]
  abierto_ahora: boolean
  mensaje_estado: string
}

/** Tipo de notificación de la campana (icono+color por tipo). */
export type NotificationTipo =
  | 'pedido' // nuevo pedido — ClipboardList
  | 'pago' // pago verificado — BadgeCheck emerald
  | 'fraude' // posible voucher falso — ShieldAlert rojo
  | 'mensaje' // mensaje de cliente — MessageCircle
  | 'estado' // pedido avanzó de estado — ArrowRight

/**
 * Notificación en memoria de sesión (campana del header). `ruta` es a dónde
 * navega el click: /panel para pedidos/pagos/fraude, /inbox para mensajes.
 */
export interface NotificationItem {
  id: string
  tipo: NotificationTipo
  texto: string
  /** Ruta al hacer click (con búsqueda si aplica). */
  ruta: string
  createdAt: string // ISO
}

/* ============================================================
 * Contrato "endurecer-local": reportes CSV, invitaciones por
 * enlace, plantillas WhatsApp y planes del SaaS
 * (openspec/changes/endurecer-local/proposal.md)
 * ============================================================ */

/**
 * GET /api/invitaciones?tenant= (manage_team) → invitación pendiente de
 * aceptar. `url` es el path relativo ("/invitar/{token}") que la UI
 * compone con el origin para compartirlo.
 */
export interface Invitation {
  id: string | number
  email: string
  rol: RolEquipo
  expires_at: string
  url: string
}

/**
 * POST /api/staff/invite {tenant, email, rol} (manage_team; admin solo lo
 * invita el dueño; 409 si el email ya está en el team o tiene invitación
 * pendiente válida) → {token, url, expires_at}. El envío por email queda
 * TODO con Resend: la UI muestra el enlace para copiar.
 */
export interface InviteLinkResult {
  token: string
  url: string
  expires_at: string
}

/**
 * GET /api/invitaciones/{token} (público, sin secrets) → estado de la
 * invitación. valida=false con motivo cuando expiró, fue revocada, ya se
 * aceptó o el token no existe (el backend puede responder 404 — la UI lo
 * normaliza a valida:false).
 */
export interface InvitacionPublica {
  valida: boolean
  local?: string
  email?: string
  rol?: RolEquipo
  motivo?: string
}

/**
 * Plantilla de WhatsApp (contrato endurecer-local, sección D): espejo local
 * de las plantillas de Meta — GET /api/whatsapp/plantillas?tenant= hace el
 * merge de las locales con las de Meta (best effort). `estado` puede venir
 * tal cual lo devuelve Meta en test (p.ej. "PENDING_APPROVAL") — la UI lo
 * muestra verbatim cuando no es uno de los canónicos.
 */
export interface WATemplate {
  id: string | number
  tenant_id?: string
  /** nombre de Meta: minúsculas, dígitos y guion bajo. */
  nombre: string
  lenguaje: 'es' | 'en' | (string & {})
  categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | (string & {})
  estado:
    | 'local'
    | 'en_revision'
    | 'aprobada'
    | 'rechazada'
    | (string & {})
  cuerpo: string
  meta_id?: string | null
  created_at?: string
}

/** GET /api/planes (público) → un plan del SaaS (trial/basico/pro). */
export interface PlanInfo {
  id: 'trial' | 'basico' | 'pro' | (string & {})
  nombre: string
  precio: number
  detalle: string
}
