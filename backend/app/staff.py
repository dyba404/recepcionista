"""Equipo del local (saas-cola-2; roles-equipo añade roles admin/staff).

GET lista el equipo completo (el owner se muestra, no se edita); POST invita
con rol "admin"|"staff" (default staff) — SOLO el owner invita admins, el
admin invita/gestiona solo staff; PATCH cambia nombre/rol en línea con las
guardas del contrato (owners intocables, último owner, self, admin-sobre-
admin); DELETE solo baja a rol staff, nunca a uno mismo y nunca admin a
admin. Todo exige la capacidad manage_team (owner+admin).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from . import security
from .db import get_session
from .deps import check_tenant_owner
from .models import User
from .roles import require_perm
from .schemas import StaffCreateIn, StaffPatchIn

router = APIRouter(prefix="/api/staff", tags=["staff"])


def staff_public(u: User) -> dict:
    return {"id": u.id, "email": u.email, "nombre": u.nombre, "rol": u.rol}


def _get_miembro(session: Session, tenant: str, user_id: int) -> User:
    """Miembro del equipo de ESTE tenant o 404 (no filtra existencia ajena)."""
    u = session.get(User, user_id)
    if u is None or u.tenant_id != tenant:
        raise HTTPException(404, "Esa persona no está en tu equipo")
    return u


@router.get("")
def list_staff(tenant: str, user: User = Depends(require_perm("manage_team")),
               session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    users = session.exec(select(User).where(User.tenant_id == tenant)
                         .order_by(User.id)).all()
    return [staff_public(u) for u in users]


@router.post("", status_code=201)
def create_staff(payload: StaffCreateIn,
                 user: User = Depends(require_perm("manage_team")),
                 session: Session = Depends(get_session)):
    check_tenant_owner(payload.tenant, user)
    # REGLA del contrato: solo el owner crea/administra admins; el admin
    # invita SOLO staff (rol default) — invitar JAMÁS crea owner (422 del schema)
    if payload.rol == "admin" and user.rol != "owner":
        raise HTTPException(403, "Solo el dueño puede invitar administradores")
    email = payload.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "Ese email ya está registrado")
    u = User(email=email,
             password_hash=security.hash_password(payload.password),
             nombre=payload.nombre.strip(), tenant_id=payload.tenant,
             rol=payload.rol)
    session.add(u)
    session.commit()
    session.refresh(u)
    return staff_public(u)


@router.patch("/{user_id}")
def patch_staff(user_id: int, tenant: str, payload: StaffPatchIn,
                user: User = Depends(require_perm("manage_team")),
                session: Session = Depends(get_session)):
    """Cambio en línea de nombre/rol. Guardas del contrato (en orden): los
    owners no se tocan por aquí (el suyo se edita en su perfil, y jamás se le
    quita el rol: sería dejar el local sin dueño), nadie se edita a sí mismo
    desde el equipo, y el admin no toca a otros admins."""
    check_tenant_owner(tenant, user)
    u = _get_miembro(session, tenant, user_id)
    if payload.nombre is None and payload.rol is None:
        raise HTTPException(400, "Nada que actualizar")
    if u.rol == "owner":
        if payload.rol is not None:
            raise HTTPException(400, "No puedes quitar el rol de dueño: es el "
                                     "único dueño del local y quedaría huérfano")
        raise HTTPException(400, "El dueño solo se edita a sí mismo desde su perfil")
    if u.id == user.id:
        raise HTTPException(400, "No puedes editarte a ti mismo")
    # admin-sobre-admin: el admin no toca a otros admins ni crea nuevos
    # (promover a admin o demotear a uno ES administrar admins → solo owner)
    if user.rol == "admin" and (u.rol == "admin" or payload.rol == "admin"):
        raise HTTPException(403, "Solo el dueño puede administrar a otros administradores")
    if payload.nombre is not None:
        if not payload.nombre.strip():
            raise HTTPException(400, "El nombre no puede estar vacío")
        u.nombre = payload.nombre.strip()
    if payload.rol is not None:
        u.rol = payload.rol
    session.add(u)
    session.commit()
    session.refresh(u)
    return staff_public(u)


@router.delete("/{user_id}")
def delete_staff(user_id: int, tenant: str,
                 user: User = Depends(require_perm("manage_team")),
                 session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    u = _get_miembro(session, tenant, user_id)
    if u.id == user.id:
        raise HTTPException(400, "No puedes eliminarte a ti mismo")
    # guardas ampliadas (roles-equipo): el admin no elimina admins
    if user.rol == "admin" and u.rol == "admin":
        raise HTTPException(403, "Solo el dueño puede eliminar administradores")
    if u.rol != "staff":
        raise HTTPException(400, "Solo se puede eliminar al personal (rol staff)")
    session.delete(u)
    session.commit()
    return {"ok": True}
