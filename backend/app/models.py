"""Modelos SQLModel persistentes (ADR 0002 + changes modulos-mvp, saas-cola-1
y saas-cola-2).

user (sesión), mensajería: conversation, message, canned_response,
module_config, whatsapp_channel; pedidos/carta: order, menu_item
(saas-cola-1); y locales/pagos: tenant, payment (saas-cola-2).
store.ORDERS, data.MENUS y data.TENANTS siguen siendo el espejo en memoria
que lee todo el código — persist.py los hidrata de estas tablas y les hace
write-through en cada mutación.
"""
# PEP 649 (Python 3.14): sin este future import el compilador no pone
# "__annotations__" en el dict de clase y sqlmodel 0.0.24 pierde los campos.
from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel

# rol: "owner" (dueño del tenant) | "admin" | "staff" (cocina, delivery).
# La matriz de capacidades por rol vive en roles.py (change roles-equipo).
ROLES = ("owner", "admin", "staff")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    nombre: str
    tenant_id: str = Field(default="faro")
    rol: str = "staff"
    created_at: datetime = Field(default_factory=_now)


# ── mensajería (modulos-mvp) ──

# Conversation.estado: "bot" (responde el bot) | "humano" (handoff, bot pausado)
#                    | "resuelta"
# Conversation.canal: "whatsapp" (Meta Cloud API) | "demo" (simulador legacy)
class Conversation(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True)
    canal: str = Field(default="demo")
    wa_id: str = Field(index=True)  # teléfono (whatsapp) o nombre (demo)
    cliente: str  # nombre de perfil Meta o nombre del cliente demo
    estado: str = Field(default="bot")
    assigned_to: int | None = Field(default=None, foreign_key="user.id")
    unread: int = Field(default=0)
    last_message_at: datetime = Field(default_factory=_now)
    created_at: datetime = Field(default_factory=_now)


# Message.role: "cliente" (desde el canal) | "bot" | "humano" (operador;
# las notas internas también usan "humano" con prefijo "[nota interna] ")
class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    conversation_id: int = Field(index=True, foreign_key="conversation.id")
    role: str
    body: str
    created_at: datetime = Field(default_factory=_now)


class CannedResponse(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True)
    shortcut: str
    texto: str


class ModuleConfig(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True)
    module_key: str
    enabled: bool = True


# WhatsAppChannel.estado: "desconectado" | "conectado" | "pausado"
class WhatsAppChannel(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True, unique=True)
    phone_number_id: str
    token: str
    estado: str = Field(default="desconectado")
    webhook_verified_at: datetime | None = None


# ── pagos (change pasarela-culqi): cuenta Culqi POR LOCAL ──

# PaymentAccount.estado: "desconectada" | "conectada". Un local = una cuenta
# por proveedor (upsert por tenant+provider en payments.py). La secret_key
# vive SOLO aquí: jamás viaja en una respuesta HTTP.
class PaymentAccount(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True)
    provider: str = Field(default="culqi")
    public_key: str
    secret_key: str
    estado: str = Field(default="desconectada")
    verified_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)


# ── pedidos + carta (change saas-cola-1: persistencia con espejo write-through) ──

# Order espeja cada dict de store.ORDERS (keyed "#101"). items/timeline van
# como JSON str (json.dumps ensure_ascii=False); los campos Culqi son null
# hasta que el pedido entra al flujo de pago.
class Order(SQLModel, table=True):
    id: str = Field(primary_key=True)  # "#101"
    tenant_id: str = Field(index=True)
    cliente: str
    items: str  # JSON: [{"id": "f1", "cant": 2}]
    total: float
    estado: str  # logic.ESTADOS: nuevo/confirmado/cocina/delivery/entregado
    pago: str  # pendiente | pendiente_verificar | pagado_culqi | pagado_yape | ...
    direccion: str
    timeline: str  # JSON: ["creado", "pagado_culqi", "cocina", ...]
    culqi_ref: str | None = None
    culqi_charge: str | None = None
    created_at: datetime = Field(default_factory=_now)


# MenuItem espeja cada dict de data.MENUS (keyed "f1"). La columna se llama
# desc_ ("desc" es palabra reservada de SQL); el dict en memoria usa "desc".
class MenuItem(SQLModel, table=True):
    id: str = Field(primary_key=True)  # "f1" seed | "m1, m2…" agregados
    tenant_id: str = Field(index=True)
    nombre: str
    desc_: str
    precio: float
    cat: str
    disponible: bool = True
    tags: str
    foto: str


# ── locales + ledger (change saas-cola-2: SaaS de verdad) ──

# Tenant es la tabla real de locales: data.TENANTS queda como espejo en memoria
# (igual que data.MENUS). id = slug ("faro", "cevicheria-x"); los ids seed
# faro/brasa/juana NO cambian. culqi_comision NO vive aquí (el contrato define
# estas columnas): el espejo la rellena con el default 0.0344 al reconstruirse
# (los 3 seed usan exactamente ese valor), que es lo que logic.culqi_link lee.
class Tenant(SQLModel, table=True):
    id: str = Field(primary_key=True)  # slug: "faro" | "cevicheria-el-faro"
    nombre: str
    rubro: str = Field(default="comidas")
    distrito: str
    delivery: float = Field(default=5.0)
    tiempo: str = Field(default="30-40 min")
    yape_qr: str = Field(default="")
    saludo: str


# Payment = ledger: UNA fila por acción de pago (charge real Culqi, webhook
# simulado, verificación Yape). gateway: "culqi_real" | "culqi_simulado" |
# "yape". estado: "verificado" | "rechazado" | "pendiente_verificar".
class Payment(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tenant_id: str = Field(index=True)
    order_id: str = Field(index=True)  # "#101"
    gateway: str
    referencia: str = Field(default="")  # charge_id Culqi | culqi_ref | ""
    monto: float
    comision: float = Field(default=0.0)
    estado: str
    detalle: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


# ── formas públicas (JSON-safe, sin secrets) ──
# Viven junto a los modelos para que whatsapp.py e inbox.py las compartan
# sin importarse entre sí (evita el ciclo process_incoming ↔ inbox).

def conversation_public(c: Conversation) -> dict:
    return {"id": c.id, "tenant_id": c.tenant_id, "canal": c.canal,
            "wa_id": c.wa_id, "cliente": c.cliente, "estado": c.estado,
            "assigned_to": c.assigned_to, "unread": c.unread,
            "last_message_at": c.last_message_at.isoformat(),
            "created_at": c.created_at.isoformat()}


def message_public(m: Message) -> dict:
    return {"id": m.id, "conversation_id": m.conversation_id, "role": m.role,
            "body": m.body, "created_at": m.created_at.isoformat()}
