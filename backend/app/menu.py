"""Rutas de la carta (ex main.py + CRUD items de saas-cola-2).

GET /api/menu público; POST /api/menu/toggle edita precio/disponibilidad
(Bearer, como siempre); POST/DELETE /api/menu/items = CRUD de platos del
owner (alta con id autogenerado m1, m2…, write-through vía persist).
"""
import re

from fastapi import APIRouter, Depends, HTTPException

from . import data, persist
from .deps import check_tenant_owner, get_current_user, require_owner
from .models import User
from .schemas import MenuItemIn, MenuToggleIn

router = APIRouter(prefix="/api/menu", tags=["menu"])


@router.get("")
def menu(tenant: str):
    if tenant not in data.MENUS:
        raise HTTPException(404, "tenant?")
    return {"tenant": data.TENANTS[tenant], "items": data.get_menu(tenant)}


@router.post("/toggle", dependencies=[Depends(get_current_user)])
def toggle(payload: MenuToggleIn):
    t = payload.tenant
    if t not in data.MENUS:
        raise HTTPException(404, "tenant?")
    it = next((x for x in data.MENUS[t] if x["id"] == payload.id), None)
    if not it:
        raise HTTPException(404, "item?")
    cambio = False
    if payload.precio is not None:
        try:
            p = round(float(payload.precio), 2)
        except (TypeError, ValueError):
            raise HTTPException(400, "Precio inválido: escribe un número, ej 32.5")
        if not (0 < p <= 9999):
            raise HTTPException(400, "Precio fuera de rango (0–9999)")
        it["precio"] = p
        cambio = True
    if payload.disponible is not None:
        it["disponible"] = bool(payload.disponible)
        cambio = True
    if cambio:
        persist.menu_write(t, it)  # write-through: cambio de precio/disponible
    return it


def _next_item_id() -> str:
    """Siguiente id m1, m2… — el escaneo es GLOBAL (la pk de menu_item es el
    id solo): dos locales no pueden tener ambos el "m1"."""
    n = 0
    for items in data.MENUS.values():
        for it in items:
            m = re.fullmatch(r"m(\d+)", it["id"])
            if m:
                n = max(n, int(m.group(1)))
    return f"m{n + 1}"


@router.post("/items")
def add_item(payload: MenuItemIn, owner: User = Depends(require_owner)):
    check_tenant_owner(payload.tenant, owner)
    if not (0 < payload.precio <= 9999):  # mismo rango que el toggle
        raise HTTPException(400, "Precio fuera de rango (0–9999)")
    item = {"id": _next_item_id(), "nombre": payload.nombre.strip(),
            "desc": payload.desc, "precio": round(float(payload.precio), 2),
            "cat": payload.cat, "disponible": payload.disponible,
            "tags": payload.tags}
    persist.menu_write(payload.tenant, item)  # write-through: fila + espejo
    # el espejo ya tiene el dict completo (con foto, la clave "desc" de logic)
    return next(x for x in data.MENUS[payload.tenant] if x["id"] == item["id"])


@router.delete("/items")
def delete_item(tenant: str, id: str, owner: User = Depends(require_owner)):
    check_tenant_owner(tenant, owner)
    if next((x for x in data.MENUS.get(tenant, []) if x["id"] == id), None) is None:
        raise HTTPException(404, "item?")
    persist.menu_delete(tenant, id)  # fila + espejo fuera
    return {"ok": True}
