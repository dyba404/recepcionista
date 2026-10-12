"""Formas de entrada (BaseModel) compartidas por los routers (saas-cola-2).

Antes vivían como BaseModel sueltos en main.py (ChatIn, OrderIn, Culqi*, Yape)
o como `payload: dict` validado a mano (toggle de carta, avance de pedidos).
Aquí están en un solo lugar para que los routers solo orquesten.

precio de MenuToggleIn admite str a propósito: el handler valida el número y
responde 400 (no 422) con el mensaje humano que el front ya conoce — "abc"
llega como string y se valida igual que cuando el payload era un dict.
"""
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


# ── equipo (saas-cola-2) ──

class StaffCreateIn(BaseModel):
    tenant: str
    email: str
    password: str = Field(min_length=8)
    nombre: str
