"""Equipo del local (saas-cola-2): staff = usuarios rol "staff" del tenant.

GET lista el equipo completo (el owner se muestra, no se edita); POST invita
(email único global → 409, password 8+); DELETE solo baja a rol staff y
nunca a uno mismo. Todo exige ser EL dueño del local.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from . import security
from .db import get_session
from .deps import check_tenant_owner, require_owner
from .models import User
from .schemas import StaffCreateIn

router = APIRouter(prefix="/api/staff", tags=["staff"])


def staff_public(u: User) -> dict:
    return {"id": u.id, "email": u.email, "nombre": u.nombre, "rol": u.rol}


@router.get("")
def list_staff(tenant: str, owner: User = Depends(require_owner),
               session: Session = Depends(get_session)):
    check_tenant_owner(tenant, owner)
    users = session.exec(select(User).where(User.tenant_id == tenant)
                         .order_by(User.id)).all()
    return [staff_public(u) for u in users]


@router.post("", status_code=201)
def create_staff(payload: StaffCreateIn, owner: User = Depends(require_owner),
                 session: Session = Depends(get_session)):
    check_tenant_owner(payload.tenant, owner)
    email = payload.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "Ese email ya está registrado")
    u = User(email=email,
             password_hash=security.hash_password(payload.password),
             nombre=payload.nombre.strip(), tenant_id=payload.tenant,
             rol="staff")
    session.add(u)
    session.commit()
    session.refresh(u)
    return staff_public(u)


@router.delete("/{user_id}")
def delete_staff(user_id: int, tenant: str, owner: User = Depends(require_owner),
                 session: Session = Depends(get_session)):
    check_tenant_owner(tenant, owner)
    u = session.get(User, user_id)
    if u is None or u.tenant_id != tenant:
        raise HTTPException(404, "Esa persona no está en tu equipo")
    if u.id == owner.id:
        raise HTTPException(400, "No puedes eliminarte a ti mismo")
    if u.rol != "staff":
        raise HTTPException(400, "Solo se puede eliminar al personal (rol staff)")
    session.delete(u)
    session.commit()
    return {"ok": True}
