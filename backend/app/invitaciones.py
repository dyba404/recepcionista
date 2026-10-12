"""Invitaciones por enlace (change endurecer-local, contrato C): el alta de
equipo sin email (patrón Chatwoot invite).

- POST /api/staff/invite (manage_team): crea la invitación y devuelve el
  ENLACE para copiar ({token, url, expires_at}); el envío por email queda
  TODO (Resend). Solo el owner invita admins (misma regla de staff.py).
- GET /api/invitaciones?tenant= (manage_team): pendientes del local
  (no aceptadas, con su expiración — la vencida se revoca, no se esconde).
- DELETE /api/invitaciones/{id}?tenant= (manage_team): revocar.
- GET /api/invitaciones/{token} (PÚBLICO): {valida, local, email, rol} sin
  secretos; expirada/aceptada → valida false con motivo.
- POST /api/invitaciones/{token}/aceptar (PÚBLICO): crea el User con el
  rol/tenant de la invitación (password min 8, 409 si el email ya existe),
  marca accepted_at y responde como el LOGIN: {access_token, token_type,
  user} — sesión iniciada directa (misma forma que auth.py register/login).

Los 409 del invite son por tenant: email ya en ESTE equipo o con invitación
pendiente válida en ESTE local (dos locales pueden invitar al mismo email).
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import data, security
from .auth import user_public
from .db import get_session
from .deps import check_tenant_owner
from .models import Invitation, User
from .roles import require_perm

router = APIRouter(tags=["invitaciones"])

EXPIRA_DIAS = 7


class InviteIn(BaseModel):
    tenant: str
    email: str
    rol: Literal["admin", "staff"] = "staff"


class AceptarIn(BaseModel):
    nombre: str = Field(min_length=1)
    password: str = Field(min_length=8)  # mismo mínimo que register/staff


def _naive(dt: datetime) -> datetime:
    """Datetime en UTC sin tzinfo para comparar: SQLite devuelve naive y
    los defaults del modelo vienen aware — se normaliza todo a naive-UTC."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _expirada(inv: Invitation) -> bool:
    return _naive(inv.expires_at) < _naive(datetime.now(timezone.utc))


@router.post("/api/staff/invite", status_code=201)
def invite(payload: InviteIn,
           user: User = Depends(require_perm("manage_team")),
           session: Session = Depends(get_session)):
    check_tenant_owner(payload.tenant, user)
    # REGLA (misma que POST /api/staff): solo el owner crea/administra admins
    if payload.rol == "admin" and user.rol != "owner":
        raise HTTPException(403, "Solo el dueño puede invitar administradores")
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(400, "Falta el email")
    if session.exec(select(User).where(User.tenant_id == payload.tenant,
                                       User.email == email)).first():
        raise HTTPException(409, "Ese email ya está en el equipo")
    # invitación pendiente VÁLIDA (no aceptada, no vencida) → 409; la vencida
    # no estorba: invitar de nuevo es la forma natural de renovarla
    pendientes = session.exec(select(Invitation).where(
        Invitation.tenant_id == payload.tenant,
        Invitation.email == email,
        Invitation.accepted_at.is_(None))).all()
    if any(not _expirada(i) for i in pendientes):
        raise HTTPException(409, "Ese email ya tiene una invitación pendiente")
    inv = Invitation(tenant_id=payload.tenant, email=email, rol=payload.rol,
                     token=secrets.token_urlsafe(24),
                     expires_at=datetime.now(timezone.utc)
                     + timedelta(days=EXPIRA_DIAS))
    session.add(inv)
    session.commit()
    session.refresh(inv)
    return {"token": inv.token, "url": f"/invitar/{inv.token}",
            "expires_at": inv.expires_at.isoformat()}


@router.get("/api/invitaciones")
def listar(tenant: str, user: User = Depends(require_perm("manage_team")),
           session: Session = Depends(get_session)):
    """Pendientes del local (accepted_at null), la más reciente primero.
    Lleva el id (para revocar) y el url (para copiar el enlace de nuevo)."""
    check_tenant_owner(tenant, user)
    rows = session.exec(select(Invitation).where(
        Invitation.tenant_id == tenant).order_by(
        Invitation.id.desc())).all()
    return [{"id": r.id, "email": r.email, "rol": r.rol,
             "expires_at": r.expires_at.isoformat(),
             "url": f"/invitar/{r.token}"} for r in rows
            if r.accepted_at is None]


@router.delete("/api/invitaciones/{invitacion_id}")
def revocar(invitacion_id: int, tenant: str,
            user: User = Depends(require_perm("manage_team")),
            session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    inv = session.get(Invitation, invitacion_id)
    if inv is None or inv.tenant_id != tenant:
        raise HTTPException(404, "Invitación no encontrada")
    session.delete(inv)
    session.commit()
    return {"ok": True}


# ── públicos (la página /invitar/{token} del frontend, fuera del login) ──

def _valores(inv: Invitation) -> dict:
    """Lo que la página pública muestra: local (nombre), email y rol. Sin
    token ni id — no hay nada más que compartir."""
    return {"local": data.TENANTS.get(inv.tenant_id, {}).get("nombre",
                                                             inv.tenant_id),
            "email": inv.email, "rol": inv.rol}


@router.get("/api/invitaciones/{token}")
def consultar(token: str, session: Session = Depends(get_session)):
    inv = session.exec(select(Invitation).where(
        Invitation.token == token)).first()
    if inv is None:
        raise HTTPException(404, "Invitación no encontrada")
    valida = inv.accepted_at is None and not _expirada(inv)
    d = {"valida": valida, **_valores(inv)}
    if not valida:
        d["motivo"] = ("ya aceptada" if inv.accepted_at is not None
                       else "expirada")
    return d


@router.post("/api/invitaciones/{token}/aceptar")
def aceptar(token: str, payload: AceptarIn,
            session: Session = Depends(get_session)):
    """Crea la cuenta con el rol/tenant de la invitación y entra directo:
    misma respuesta que POST /api/auth/login (contrato C)."""
    inv = session.exec(select(Invitation).where(
        Invitation.token == token)).first()
    if inv is None:
        raise HTTPException(404, "Invitación no encontrada")
    if inv.accepted_at is not None:
        raise HTTPException(400, "La invitación ya fue aceptada")
    if _expirada(inv):
        raise HTTPException(400, "La invitación expiró")
    if session.exec(select(User).where(User.email == inv.email)).first():
        raise HTTPException(409, "Ese email ya está registrado")
    u = User(email=inv.email,
             password_hash=security.hash_password(payload.password),
             nombre=payload.nombre.strip(), tenant_id=inv.tenant_id,
             rol=inv.rol)
    inv.accepted_at = datetime.now(timezone.utc)
    session.add(u)
    session.add(inv)
    session.commit()
    session.refresh(u)
    return {"access_token": security.create_token(u.id, u.email),
            "token_type": "bearer", "user": user_public(u)}
