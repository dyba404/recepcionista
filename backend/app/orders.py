"""Rutas de pedidos (ex main.py, saas-cola-2): Kanban + avance con regla
anti-fraude (no se pasa a cocina sin pago verificado). carta-inventario-bot
añade el control de stock del POS ligero en el alta: 409 con TODOS los
faltantes ANTES de crear el pedido, y decremento write-through solo si todo
pasó (un pedido rechazado no mueve inventario)."""
from fastapi import APIRouter, Depends, HTTPException

from . import data, logic, persist, store, ws
from .deps import get_current_user
from .roles import require_perm
from .schemas import OrderIn, OrderPatchIn

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _validar_stock(tenant: str, items: list) -> dict:
    """Stock restante tras el pedido, o lanza 409 con TODOS los faltantes.

    - stock null (ilimitado) y cant <= 0 no consumen ni fallan.
    - Por cada línea se descuenta del stock restante ACUMULADO (dos líneas
      del mismo plato suman consumo antes de validar).
    - El 409 junta todos los faltantes en el detail: "… agotado (quedan N)"
      (contrato). Se valida ANTES de crear: nada se decrementa si falla.
    """
    menu = {i["id"]: i for i in data.MENUS[tenant]}
    restante: dict[str, int] = {}
    faltantes: list[str] = []
    for line in items:
        it = menu.get(line.get("id"))
        if it is None:
            continue  # id desconocido: calc_total también lo ignora
        cant = float(line.get("cant", 1) or 0)
        if it.get("stock") is None or cant <= 0:
            continue
        disp = restante.get(it["id"], it["stock"])
        if disp < cant:
            faltantes.append(f"{it['nombre']} agotado (quedan {max(0, disp)})")
        else:
            restante[it["id"]] = int(disp - cant)  # NUNCA negativo
    if faltantes:
        raise HTTPException(409, "Stock insuficiente: " + "; ".join(faltantes))
    return restante


@router.post("")
def create_order(o: OrderIn):
    if o.tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    with store.LOCK:
        restante = _validar_stock(o.tenant, o.items)  # 409 antes de crear
        store.COUNTER["n"] += 1
        oid = f"#{store.COUNTER['n']}"
        total = logic.calc_total(o.tenant, o.items)
        store.ORDERS[oid] = {"id": oid, "tenant": o.tenant, "cliente": o.cliente,
                             "items": o.items, "total": total, "estado": "nuevo",
                             "pago": "pendiente", "direccion": o.direccion,
                             "timeline": ["creado"]}
        persist.order_write(store.ORDERS[oid])  # write-through: nace en la BD
        # decremento del POS (contrato): solo si el pedido ya nació, y por
        # write-through — persist.menu_write actualiza fila + espejo.
        menu = {i["id"]: i for i in data.MENUS[o.tenant]}
        for iid, nuevo in restante.items():
            menu[iid]["stock"] = nuevo
            persist.menu_write(o.tenant, menu[iid])
    ws.manager.broadcast("order.created", store.ORDERS[oid])
    return store.ORDERS[oid]


@router.get("", dependencies=[Depends(get_current_user)])
def list_orders(tenant: str | None = None):
    with store.LOCK:
        vals = list(store.ORDERS.values())
    if tenant:
        vals = [v for v in vals if v["tenant"] == tenant]
    return sorted(vals, key=lambda x: x["id"], reverse=True)


@router.patch("/{oid}", dependencies=[Depends(require_perm("manage_orders"))])
def advance(oid: str, payload: OrderPatchIn):
    if oid not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[oid]
    cambio = False
    with store.LOCK:
        if payload.estado is not None:
            if payload.estado not in logic.ESTADOS:
                raise HTTPException(400, "estado?")
            # regla anti-fraude: no pasar a cocina sin pago verificado
            if payload.estado in ("cocina", "delivery", "entregado") and o["pago"] in ("pendiente", "pendiente_verificar"):
                raise HTTPException(400, "No se puede avanzar sin pago verificado (anti Yape-falso)")
            o["estado"] = payload.estado
            o["timeline"].append(payload.estado)
            cambio = True
        if payload.pago is not None:
            o["pago"] = payload.pago
            o["timeline"].append(payload.pago)
            cambio = True
        if cambio:
            persist.order_write(o)  # write-through: estado/pago/timeline
    if cambio:
        ws.manager.broadcast("order.updated", o)
    return o
