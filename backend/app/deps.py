"""Dependencias FastAPI: auth Bearer contra la BD de usuarios (ADR 0002)."""
from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from . import security
from .db import get_session
from .models import User


def _no_autenticado() -> HTTPException:
    return HTTPException(401, "No autenticado", headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> User:
    """401 {"detail": "No autenticado"} si falta, es inválido o expiró el token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise _no_autenticado()
    claims = security.decode_token(authorization[len("Bearer "):].strip())
    if not claims:
        raise _no_autenticado()
    try:
        user_id = int(claims.get("sub", ""))
    except ValueError:
        raise _no_autenticado() from None
    user = session.get(User, user_id)
    if user is None:
        raise _no_autenticado()
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    """403 si no es owner (configuración del tenant: módulos, canal WhatsApp)."""
    if user.rol != "owner":
        raise HTTPException(403, "Solo el dueño puede configurar esto")
    return user
