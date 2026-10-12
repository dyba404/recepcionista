"""Roles del equipo y sus capacidades (change roles-equipo).

El patrón es el de Chatwoot: el usuario tiene un ROL y el rol aporta un set
de CAPACIDADES; los endpoints exigen una capacidad, no un rol. Así añadir un
rol o regalarle una capacidad no obliga a re-cablear rutas (en Chatwoot,
administrator/agent + permissions por capability).

- owner: creador del negocio — TODO (incluye el dinero: módulos y cuenta
  Culqi, que siguen gateados con require_owner).
- admin: administra el local — equipo (solo staff: invitar/tocar admins es
  del owner), carta, configuración, pedidos, inbox y ledger. NO módulos ni
  cuenta Culqi.
- staff: operativo — avanza pedidos y atiende el inbox.

PERMISOS: dict[rol, set[capacidad]]. require_perm(capacidad) es la
dependencia FastAPI: resuelve el user de la sesión y lanza
403 {"detail": "Tu rol no permite <capacidad>"} si su rol no la tiene.
"""
from fastapi import Depends, HTTPException

from .deps import get_current_user
from .models import User

# capacidades del sistema (lo que un endpoint puede exigir)
CAPACIDADES = ("manage_team", "manage_menu", "manage_settings",
               "manage_orders", "answer_inbox", "view_ledger")

# rol: "owner" (dueño del tenant) | "admin" | "staff" (cocina, delivery)
ROLES = ("owner", "admin", "staff")

PERMISOS: dict[str, set[str]] = {
    "owner": set(CAPACIDADES),  # TODO
    "admin": {"manage_team", "manage_menu", "manage_settings",
              "manage_orders", "answer_inbox", "view_ledger"},
    "staff": {"manage_orders", "answer_inbox"},
}


def tiene_permiso(rol: str, capacidad: str) -> bool:
    return capacidad in PERMISOS.get(rol, set())


def require_perm(capacidad: str):
    """Dependencia FastAPI: el usuario de la sesión debe tener `capacidad`
    según el rol de su tenant; si no, 403 {"detail": "Tu rol no permite
    <capacidad>"} (el 401 de "no autenticado" lo pone get_current_user)."""
    def _require(user: User = Depends(get_current_user)) -> User:
        if not tiene_permiso(user.rol, capacidad):
            raise HTTPException(403, f"Tu rol no permite {capacidad}")
        return user
    return _require
