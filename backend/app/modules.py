"""Registro de módulos del SaaS con toggles REALES por tenant (modulos-mvp).

- GET /api/modules?tenant= : catálogo + estado por tenant (público).
- PATCH /api/modules/{key} {tenant, enabled} : solo owner del tenant.
- gates(tenant, key) : gating real — 403 "Módulo desactivado..." en todos los
  endpoints que dependen del módulo. kds/carta son solo flag para el front
  (sus endpoints aún no existen en el backend).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from . import data
from .db import engine, get_session
from .deps import require_owner
from .models import ModuleConfig, User

router = APIRouter(prefix="/api/modules", tags=["modules"])

GATED_DETAIL = "Módulo desactivado: actívalo en Configuración"

# key → (nombre, descripcion). "Próximamente" (reservas, facturación, ...) es
# display-only del front: no vive en el backend.
MODULES = {
    "whatsapp": ("Conectar WhatsApp",
                  "Canal Meta WhatsApp Cloud API con webhook y wizard de conexión"),
    "inbox": ("Inbox y handoff",
              "Conversaciones en vivo, tomar el control, responder como humano"),
    "pagos": ("Pagos Culqi/Yape",
              "Cobros con link Culqi y verificación Yape en el chat"),
    "kds": ("Cocina KDS", "Vista de cocina con avance de pedidos en tiempo real"),
    "carta": ("Carta admin", "Editar platos, precios y disponibilidad"),
}

# módulos con gating REAL de servidor (403); el resto es solo flag del front
SERVER_GATED = ("whatsapp", "inbox", "pagos")


def module_enabled(tenant: str, key: str, session: Session | None = None) -> bool:
    """Estado del módulo para el tenant. Sin fila = activado (default ON,
    coherente con el seed); fail-open porque el seed cubre todos los tenants."""
    if session is None:
        # gates() desde handlers sin sesión propia (main.py, /api/chat)
        with Session(engine) as own:
            return module_enabled(tenant, key, own)
    cfg = session.exec(
        select(ModuleConfig).where(ModuleConfig.tenant_id == tenant,
                                    ModuleConfig.module_key == key)).first()
    return True if cfg is None else bool(cfg.enabled)


def gates(tenant: str, key: str, session: Session | None = None) -> None:
    """Lanza 403 {"detail": GATED_DETAIL} si el módulo está apagado."""
    if not module_enabled(tenant, key, session):
        raise HTTPException(403, GATED_DETAIL)


def _entry(key: str, tenant: str, session: Session) -> dict:
    nombre, descripcion = MODULES[key]
    return {"key": key, "nombre": nombre, "descripcion": descripcion,
            "enabled": module_enabled(tenant, key, session),
            "server_gated": key in SERVER_GATED}


class ModuleToggleIn(BaseModel):
    tenant: str
    enabled: bool


def _check_tenant(tenant: str) -> None:
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")


@router.get("")
def list_modules(tenant: str, session: Session = Depends(get_session)):
    _check_tenant(tenant)
    return [_entry(k, tenant, session) for k in MODULES]


@router.patch("/{key}")
def toggle_module(key: str, payload: ModuleToggleIn,
                 owner: User = Depends(require_owner),
                 session: Session = Depends(get_session)):
    if key not in MODULES:
        raise HTTPException(404, f"Módulo desconocido: {key}")
    _check_tenant(payload.tenant)
    if owner.tenant_id != payload.tenant:
        # multi-tenant: un dueño no apaga los módulos del local de otro
        raise HTTPException(403, "Solo el dueño de este tenant puede configurarlo")
    cfg = session.exec(
        select(ModuleConfig).where(ModuleConfig.tenant_id == payload.tenant,
                                    ModuleConfig.module_key == key)).first()
    if cfg is None:
        cfg = ModuleConfig(tenant_id=payload.tenant, module_key=key,
                           enabled=payload.enabled)
    else:
        cfg.enabled = payload.enabled
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return _entry(key, payload.tenant, session)
