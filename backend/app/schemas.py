"""Formas de entrada (BaseModel) compartidas por los routers (saas-cola-2;
carta-inventario-bot añade el PATCH de platos con sentinel de stock, la KB
y el Asistente).

Antes vivían como BaseModel sueltos en main.py (ChatIn, OrderIn, Culqi*, Yape)
o como `payload: dict` validado a mano (toggle de carta, avance de pedidos).
Aquí están en un solo lugar para que los routers solo orquesten.

precio de MenuToggleIn admite str a propósito: el handler valida el número y
responde 400 (no 422) con el mensaje humano que el front ya conoce — "abc"
llega como string y se valida igual que cuando el payload era un dict.
"""
from typing import Literal

from pydantic import BaseModel, Field

# ── chat (ex main.py) ──

class ChatIn(BaseModel):
    tenant: str
    customer: str = "Demo"
    message: str
    cart: list = []


# ── pedidos (ex main.py) ──

class OrderIn(BaseModel):
    tenant: str
    cliente: str
    items: list
    direccion: str = ""


class OrderPatchIn(BaseModel):
    """Avance de pedido: estado (validado contra logic.ESTADOS en el handler,
    400 "estado?" si es desconocido) o pago directo."""
    estado: str | None = None
    pago: str | None = None


# ── carta (ex dict inline de main.py) ──

class MenuToggleIn(BaseModel):
    tenant: str
    id: str
    precio: float | str | None = None
    disponible: bool | None = None


class MenuItemIn(BaseModel):
    """Alta de plato: id autogenerado (m1, m2…) por el backend."""
    tenant: str
    nombre: str
    desc: str = ""
    precio: float
    cat: str = ""
    disponible: bool = True
    tags: str = ""


# Sentinel módulo-level (carta-inventario-bot): valor por omisión de
# MenuItemPatchIn.stock que significa "la clave no vino en el payload".
# CONVENCIÓN ÚNICA de stock en el PATCH, distinguida con DOS mecanismos que
# se refuerzan (el patrón "sentinel + model_fields_set" pedido por contrato):
#   - clave AUSENTE   → stock queda como está (model_fields_set no la tiene
#                       Y el valor sigue siendo el sentinel)
#   - "stock": null   → volver a ILIMITADO (la clave vino y el valor es None)
#   - "stock": 5      → fijar stock=5 (ge=0: negativo → 422 de pydantic)
# pydantic v2 no valida defaults, así que el sentinel puede vivir en un
# campo `int | None` sin romper el schema; usar el sentinel (y no solo
# model_fields_set) hace que el propio VALOR sea inequívoco: leer
# `payload.stock` nunca confunde "ausente" con "null explícito", aunque el
# modelo se reconstruya por el camino que sea.
STOCK_UNSET: object = object()


class MenuItemPatchIn(BaseModel):
    """Edición completa del plato (PATCH /api/menu/items, manage_menu). Solo
    las claves presentes se tocan; el resto queda como está. precio admite
    str a propósito: el handler valida el número y responde 400 con el
    mensaje humano que el front ya conoce (mismo contrato que el toggle)."""
    tenant: str
    id: str
    nombre: str | None = None
    desc: str | None = None
    precio: float | str | None = None
    cat: str | None = None
    disponible: bool | None = None
    stock: int | None = Field(default=STOCK_UNSET, ge=0)


# ── pagos (ex main.py) ──

class CulqiLinkIn(BaseModel):
    tenant: str
    order_id: str


class CulqiWHIn(BaseModel):
    reference_id: str


class CulqiChargeIn(BaseModel):
    order_id: str
    token: str


class YapeIn(BaseModel):
    order_id: str
    monto_foto: float


# ── locales (saas-cola-2) ──

class TenantCreateIn(BaseModel):
    nombre: str
    distrito: str
    delivery: float = 5.0
    tiempo: str = "30-40 min"
    yape_qr: str = ""


class TenantPatchIn(BaseModel):
    nombre: str | None = None
    delivery: float | None = None
    tiempo: str | None = None
    yape_qr: str | None = None


class NegocioIn(BaseModel):
    """Sección opcional de /api/auth/register: crea el local Y al usuario
    como owner de él, en una sola transacción."""
    nombre: str
    distrito: str
    delivery: float = 5.0


# ── equipo (saas-cola-2; roles-equipo añade rol y PATCH) ──

class StaffCreateIn(BaseModel):
    """Invitación: rol "admin"|"staff" (default staff, 422 cualquier otro
    valor — invitar JAMÁS crea owner). Solo el owner puede invitar admins;
    el admin invita solo staff (esa regla vive en staff.py)."""
    tenant: str
    email: str
    password: str = Field(min_length=8)
    nombre: str
    rol: Literal["admin", "staff"] = "staff"


class StaffPatchIn(BaseModel):
    """Cambio en línea de nombre/rol. rol "admin"|"staff" (422 otro valor):
    el owner reasigna staff↔admin; los owners nunca se editan por aquí."""
    nombre: str | None = None
    rol: Literal["admin", "staff"] | None = None


# ── base de conocimiento (carta-inventario-bot) ──

class KBCreateIn(BaseModel):
    """Alta de entrada de KB: tema/contenido requeridos y no vacíos (422)."""
    tenant: str
    tema: str = Field(min_length=1)
    contenido: str = Field(min_length=1)
    activo: bool = True


class KBPatchIn(BaseModel):
    """Edición de entrada: todo opcional; "activo": false desactiva sin
    borrar (la entrada deja de alimentar el prompt y al NLU)."""
    tema: str | None = Field(default=None, min_length=1)
    contenido: str | None = Field(default=None, min_length=1)
    activo: bool | None = None


# ── bot configurable / Asistente (carta-inventario-bot) ──

class BotConfigPutIn(BaseModel):
    """PUT del Asistente: todo opcional salvo el tenant (PUT parcial sobre la
    fila; los campos ausentes quedan como están). tono es Literal (422 con
    otro valor) e instrucciones_extra máx 800 chars (422 si excede) —
    contrato explícito del change."""
    tenant: str
    nombre_bot: str | None = Field(default=None, min_length=1)
    saludo: str | None = None
    tono: Literal["cercano", "formal", "divertido"] | None = None
    instrucciones_extra: str | None = Field(default=None, max_length=800)
