"""Rutas /api/auth/*: registro, login y perfil (ADR 0002; saas-cola-2 añade
el registro CON negocio: crea el local y al owner de él en una transacción)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import persist, security, tenants
from .db import get_session
from .deps import get_current_user
from .models import User
from .schemas import NegocioIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=8)
    nombre: str
    tenant_id: str = "faro"
    # sección "Tu negocio" (opcional): crea el tenant Y al usuario como su
    # owner, en la MISMA transacción (si algo falla, no queda ni user ni local)
    negocio: NegocioIn | None = None


class LoginIn(BaseModel):
    email: str
    password: str


def user_public(user: User) -> dict:
    """Forma única de exponer un usuario: sin password_hash, JSON-safe."""
    return {"id": user.id, "email": user.email, "nombre": user.nombre,
            "tenant_id": user.tenant_id, "rol": user.rol,
            "created_at": user.created_at.isoformat()}


@router.post("/register", status_code=201)
def register(payload: RegisterIn, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "Ese email ya está registrado")
    tenant_id = payload.tenant_id.strip() or "faro"
    tenant_nuevo = None
    if payload.negocio is not None:
        # registro con negocio: el local se crea en ESTA sesión (sin commit)
        # y el usuario nace apuntando a él — un solo commit = atómico
        tenant_nuevo = tenants.crear_tenant(
            session, payload.negocio.nombre, payload.negocio.distrito,
            payload.negocio.delivery, "30-40 min", "")
        tenant_id = tenant_nuevo.id
    # quien registra su negocio queda como owner de su tenant
    user = User(email=email, password_hash=security.hash_password(payload.password),
                nombre=payload.nombre.strip(), tenant_id=tenant_id,
                rol="owner")
    session.add(user)
    session.commit()
    session.refresh(user)
    if tenant_nuevo is not None:
        persist.tenant_mirror(tenant_nuevo)  # espejo: local + carta vacía
    return user_public(user)


@router.post("/login")
def login(payload: LoginIn, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    # mismo 401 para email inexistente y password mala: no se filtra cuál falló
    if not user or not security.verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email o contraseña incorrectos")
    return {"access_token": security.create_token(user.id, user.email),
            "token_type": "bearer", "user": user_public(user)}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_public(user)
