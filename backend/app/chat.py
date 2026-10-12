"""Rutas del chat público y tracking (ex main.py, saas-cola-2).

POST /api/chat: NLU determinista primero; opencode (LLM) solo redacta el
long tail. Con inbox ON el simulador legacy alimenta el MISMO inbox por el
canal "demo"; con inbox OFF queda el comportamiento original sin
persistencia de conversación. GET /api/track: pedidos del cliente.
"""
from fastapi import APIRouter, HTTPException

from . import brain, data, modules, store, whatsapp
from .schemas import ChatIn

router = APIRouter(prefix="/api", tags=["chat"])

# con el módulo inbox ON, un humano con el control responde el simulador
HANDOFF_REPLY = ("Ahora te atiende una persona del equipo. "
                 "En breve te responde por aquí.")


@router.post("/chat")
def chat(c: ChatIn):
    if c.tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    if modules.module_enabled(c.tenant, "inbox"):
        result = whatsapp.process_incoming(c.tenant, canal="demo",
                                           wa_id=c.customer, name=c.customer,
                                           text=c.message, cart=c.cart)
        if result is None:  # handoff: el operador tiene el control, bot pausado
            result = {"reply": HANDOFF_REPLY, "cart": []}
    else:
        result = brain.reply(c.tenant, c.customer, c.message, c.cart)
    st = store.client_state(c.tenant, c.customer)
    result.setdefault("direccion", st.get("direccion", ""))
    return result


@router.get("/track")
def track(tenant: str, cliente: str):
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    pedidos = store.track_orders(tenant, cliente)
    return [{"id": o["id"], "estado": o["estado"], "pago": o["pago"],
             "total": o["total"], "items": o["items"], "direccion": o["direccion"]}
            for o in pedidos]
