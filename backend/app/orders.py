"""Rutas de pedidos (ex main.py, saas-cola-2): Kanban + avance con regla
anti-fraude (no se pasa a cocina sin pago verificado)."""
from fastapi import APIRouter, Depends, HTTPException

from . import data, logic, persist, store, ws
from .deps import get_current_user
from .roles import require_perm
from .schemas import OrderIn, OrderPatchIn

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.post("")
def create_order(o: OrderIn):
    if o.tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    with store.LOCK:
        store.COUNTER["n"] += 1
        oid = f"#{store.COUNTER['n']}"
        total = logic.calc_total(o.tenant, o.items)
        store.ORDERS[oid] = {"id": oid, "tenant": o.tenant, "cliente": o.cliente,
                             "items": o.items, "total": total, "estado": "nuevo",
                             "pago": "pendiente", "direccion": o.direccion,
                             "timeline": ["creado"]}
        persist.order_write(store.ORDERS[oid])  # write-through: nace en la BD
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
