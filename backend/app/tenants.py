"""Rutas de locales (saas-cola-2): listado público, alta de local (owner
autenticado), edición por el dueño y QR de Yape real (upload/download).
endurecer-local E añade PATCH /{id}/plan (activación por el owner).

Los locales viven en SQLite (tabla tenant) y data.TENANTS es su espejo en
memoria (persist.py hidrata y refleja) — GET devuelve el espejo, que es lo
mismo que la BD, con la misma forma de siempre (+ plan/trial_hasta).
"""
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from . import data, horarios, persist
from .db import get_session
from .deps import check_tenant_owner, require_owner
from .models import Tenant, User
from .roles import require_perm
from .schemas import PlanPatchIn, TenantCreateIn, TenantPatchIn

router = APIRouter(prefix="/api/tenants", tags=["tenants"])

# QR de Yape por local: backend/uploads/{id}_yape_qr.png. UPLOADS_DIR deja
# apuntar los tests a un dir temporal (mismo patrón que AUTH_DB_PATH).
UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR")
                   or Path(__file__).resolve().parent.parent / "uploads")
QR_MAX_BYTES = 2 * 1024 * 1024  # 2MB
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
QR_EXTS = (".png", ".jpg", ".jpeg")


def _slug(nombre: str) -> str:
    """Nombre → slug: minúsculas, sin acentos ni espacios ("Cevichería El
    Faro" → "cevicheria-el-faro"). Vacío (nombre solo símbolos) → "local"."""
    s = unicodedata.normalize("NFD", nombre.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "local"


def unique_slug(session: Session, nombre: str) -> str:
    """Slug disponible: si colisiona, sufijo -2, -3… (contrato)."""
    base = _slug(nombre)
    slug, n = base, 1
    while session.get(Tenant, slug) is not None or slug in data.TENANTS:
        n += 1
        slug = f"{base}-{n}"
    return slug


def crear_tenant(session: Session, nombre: str, distrito: str,
                 delivery: float, tiempo: str, yape_qr: str) -> Tenant:
    """Crea el local DENTRO de la sesión del caller — SIN commit: la
    transacción la cierra quien llama (register crea user+tenant atómicos;
    POST /api/tenants reasigna al creador en el mismo commit). El saludo se
    genera del nombre, como los seed.

    endurecer-local E: todo local NUEVO nace en plan "trial" con 14 días de
    prueba (registro con negocio y POST /api/tenants); los 3 seed del demo
    nacen "basico" (persist._seed_tenant_rows) para que el demo no expire."""
    nombre = nombre.strip()
    t = Tenant(id=unique_slug(session, nombre), nombre=nombre,
               distrito=distrito.strip(), delivery=float(delivery),
               tiempo=tiempo, yape_qr=yape_qr,
               plan="trial",
               trial_hasta=datetime.now(timezone.utc) + timedelta(days=14),
               saludo=f"Hola! Soy el asistente de {nombre}. ¿Te muestro la carta?")
    session.add(t)
    # horarios-pausa-notif-perfil: el local nace con sus 7 filas de horario
    # (12:00-22:00 activo) — mismo seed que seed.run da a los 3 demo.
    horarios.seed_horarios(session, t.id)
    return t


@router.get("")
def tenants():
    return list(data.TENANTS.values())


@router.post("")
def create_tenant(payload: TenantCreateIn, owner: User = Depends(require_owner),
                  session: Session = Depends(get_session)):
    """Alta de local: cualquier owner autenticado crea SU local y pasa a ser
    su dueño (user.tenant_id apunta al nuevo slug — PATCH/QR/staff suyos)."""
    t = crear_tenant(session, payload.nombre, payload.distrito,
                     payload.delivery, payload.tiempo, payload.yape_qr)
    owner.tenant_id = t.id
    session.commit()
    session.refresh(t)
    persist.tenant_mirror(t)  # espejo: local + clave de carta vacía
    return persist.tenant_dict(t)


@router.patch("/{tenant_id}")
def patch_tenant(tenant_id: str, payload: TenantPatchIn,
                 user: User = Depends(require_perm("manage_settings")),
                 session: Session = Depends(get_session)):
    """Edita delivery/tiempo/yape_qr/nombre — capacidad manage_settings
    (owner+admin, change roles-equipo), solo del propio local."""
    check_tenant_owner(tenant_id, user)
    row = session.get(Tenant, tenant_id)
    if row is None:  # defensivo: el espejo lo tiene, la fila también debe
        raise HTTPException(404, "tenant?")
    if payload.nombre is not None:
        row.nombre = payload.nombre.strip()  # el slug/id NO cambia nunca
    if payload.delivery is not None:
        row.delivery = float(payload.delivery)
    if payload.tiempo is not None:
        row.tiempo = payload.tiempo
    if payload.yape_qr is not None:
        row.yape_qr = payload.yape_qr
    session.commit()
    session.refresh(row)
    persist.tenant_mirror(row)
    return persist.tenant_dict(row)


@router.patch("/{tenant_id}/plan")
def patch_plan(tenant_id: str, payload: PlanPatchIn,
               owner: User = Depends(require_owner),
               session: Session = Depends(get_session)):
    """Activa el plan del local (endurecer-local E, SOLO owner). Guardado
    simple + nota honesta: el cobro automático llega con Culqi
    Suscripciones (pendiente de cuenta externa). trial_hasta NO se toca —
    queda como registro de cuándo acabó la prueba."""
    check_tenant_owner(tenant_id, owner)
    row = session.get(Tenant, tenant_id)
    if row is None:  # defensivo: el espejo lo tiene, la fila también debe
        raise HTTPException(404, "tenant?")
    row.plan = payload.plan
    session.add(row)
    session.commit()
    session.refresh(row)
    persist.tenant_mirror(row)
    return {**persist.tenant_dict(row),
            "nota": "Plan activado en modo manual — el cobro automático "
                    "llega con Culqi Suscripciones"}


# ── QR de Yape real (saas-cola-2) ──

def qr_path(tenant_id: str) -> Path:
    return UPLOADS_DIR / f"{tenant_id}_yape_qr.png"


@router.post("/{tenant_id}/qr")
def upload_qr(tenant_id: str, file: UploadFile = File(...),
              user: User = Depends(require_perm("manage_settings"))):
    """Sube el QR de Yape del local (png/jpg real por magic bytes + extensión,
    máx 2MB → 400). Se guarda como {id}_yape_qr.png; /api/payments/config lo
    anuncia con yape_qr_imagen=true. La verificación de pago sigue siendo
    monto exacto — el QR es solo la imagen que ve el cliente."""
    check_tenant_owner(tenant_id, user)
    contenido = file.file.read()
    if len(contenido) > QR_MAX_BYTES:
        raise HTTPException(400, "El QR pesa más de 2MB")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in QR_EXTS:
        raise HTTPException(400, "Solo se acepta una imagen png o jpg")
    if not (contenido.startswith(PNG_MAGIC) or contenido.startswith(JPEG_MAGIC)):
        raise HTTPException(400, "El archivo no es una imagen png/jpg válida")
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    qr_path(tenant_id).write_bytes(contenido)
    return {"ok": True}


@router.get("/{tenant_id}/qr")
def get_qr(tenant_id: str):
    """El QR del local (público: lo ve el cliente en el paybox) o 404."""
    if tenant_id not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    p = qr_path(tenant_id)
    if not p.is_file():
        raise HTTPException(404, "Este local aún no subió su QR de Yape")
    return FileResponse(p, media_type="image/png")
