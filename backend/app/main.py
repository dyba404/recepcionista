import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import brain, data, inbox, logic, modules, payments, persist, seed, store, whatsapp, ws
from .auth import router as auth_router
from .deps import get_current_user

app = FastAPI(title="SaaS Recepcionista WhatsApp — prototipo")
BASE = os.path.dirname(os.path.dirname(__file__))  # backend/
ROOT = os.path.dirname(BASE)  # raíz del repo: static/ (legacy), docs/

persist.hydrate()  # espejo: pedidos/carta siembran BD vacía y se cargan de ella
seed.run()  # usuarios demo + módulos ON (idempotente)

app.include_router(auth_router)
app.include_router(ws.router)
app.include_router(modules.router)
app.include_router(inbox.router)
app.include_router(whatsapp.router)
app.include_router(whatsapp.webhook_router)
app.include_router(payments.router)  # cuenta Culqi por local (pasarela-culqi)

class ChatIn(BaseModel):
    tenant: str
    customer: str = "Demo"
    message: str
    cart: list = []

class OrderIn(BaseModel):
    tenant: str
    cliente: str
    items: list
    direccion: str = ""

class CulqiLinkIn(BaseModel):
    tenant: str
    order_id: str

class CulqiWHIn(BaseModel):
    reference_id: str

class CulqiChargeIn(BaseModel):
    order_id: str
    token: str

class YapeIn(BaseModel):
    order_id: str
    monto_foto: float

@app.get("/api/tenants")
def tenants():
    return list(data.TENANTS.values())

@app.get("/api/menu")
def menu(tenant: str):
    if tenant not in data.MENUS:
        raise HTTPException(404, "tenant?")
    return {"tenant": data.TENANTS[tenant], "items": data.get_menu(tenant)}

@app.post("/api/menu/toggle", dependencies=[Depends(get_current_user)])
def toggle(payload: dict):
    t = payload.get("tenant")
    if t not in data.MENUS:
        raise HTTPException(404, "tenant?")
    it = next((x for x in data.MENUS[t] if x["id"] == payload.get("id")), None)
    if not it:
        raise HTTPException(404, "item?")
    cambio = False
    if "precio" in payload:
        try:
            p = round(float(payload["precio"]), 2)
        except (TypeError, ValueError):
            raise HTTPException(400, "Precio inválido: escribe un número, ej 32.5")
        if not (0 < p <= 9999):
            raise HTTPException(400, "Precio fuera de rango (0–9999)")
        it["precio"] = p
        cambio = True
    if "disponible" in payload:
        it["disponible"] = bool(payload["disponible"])
        cambio = True
    if cambio:
        persist.menu_write(t, it)  # write-through: cambio de precio/disponible
    return it

# con el módulo inbox ON, un humano con el control responde el simulador
HANDOFF_REPLY = ("Ahora te atiende una persona del equipo. "
                 "En breve te responde por aquí.")


@app.post("/api/chat")
def chat(c: ChatIn):
    if c.tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    # NLU determinista primero; opencode (LLM) solo redacta el long tail.
    # Con inbox ON el simulador legacy alimenta el MISMO inbox por el canal
    # "demo" (mismas conversaciones que WhatsApp); con inbox OFF queda el
    # comportamiento original sin persistencia de conversación.
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

@app.get("/api/track")
def track(tenant: str, cliente: str):
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    pedidos = store.track_orders(tenant, cliente)
    return [{"id": o["id"], "estado": o["estado"], "pago": o["pago"],
             "total": o["total"], "items": o["items"], "direccion": o["direccion"]}
            for o in pedidos]

@app.post("/api/orders")
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

@app.get("/api/orders", dependencies=[Depends(get_current_user)])
def list_orders(tenant: str | None = None):
    with store.LOCK:
        vals = list(store.ORDERS.values())
    if tenant:
        vals = [v for v in vals if v["tenant"] == tenant]
    return sorted(vals, key=lambda x: x["id"], reverse=True)

@app.patch("/api/orders/{oid}", dependencies=[Depends(get_current_user)])
def advance(oid: str, payload: dict):
    if oid not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[oid]
    cambio = False
    with store.LOCK:
        if "estado" in payload:
            if payload["estado"] not in logic.ESTADOS:
                raise HTTPException(400, "estado?")
            # regla anti-fraude: no pasar a cocina sin pago verificado
            if payload["estado"] in ("cocina", "delivery", "entregado") and o["pago"] in ("pendiente", "pendiente_verificar"):
                raise HTTPException(400, "No se puede avanzar sin pago verificado (anti Yape-falso)")
            o["estado"] = payload["estado"]
            o["timeline"].append(payload["estado"])
            cambio = True
        if "pago" in payload:
            o["pago"] = payload["pago"]
            o["timeline"].append(payload["pago"])
            cambio = True
        if cambio:
            persist.order_write(o)  # write-through: estado/pago/timeline
    if cambio:
        ws.manager.broadcast("order.updated", o)
    return o

@app.post("/api/payments/culqi/link")
def culqi_link(p: CulqiLinkIn):
    modules.gates(p.tenant, "pagos")  # gating real del módulo
    if p.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[p.order_id]
    link = logic.culqi_link(p.tenant, p.order_id, o["total"])
    o["culqi_ref"] = link["reference_id"]
    o["timeline"].append("link_culqi")
    persist.order_write(o)  # write-through: culqi_ref + timeline
    return link

@app.get("/api/payments/config")
def pay_config(tenant: str):
    """Qué puede ofrecer el front: Culqi REAL por LOCAL (la cuenta del tenant,
    con su pk completa para culqi.js) o SIMULADO (caída a la env CULQI_PUBLIC_KEY
    del prototipo, una sola cuenta compartida)."""
    t = data.TENANTS.get(tenant)
    if not t:
        raise HTTPException(404, "tenant?")
    modules.gates(tenant, "pagos")  # gating real del módulo
    cuenta = payments.get_account(tenant)
    return {"culqi_pk": (cuenta.public_key if cuenta
                         else os.environ.get("CULQI_PUBLIC_KEY", "")),
            "culqi_estado": "conectada" if cuenta else "simulada",
            "culqi_pk_enmascarada": (payments.enmascarar_pk(cuenta.public_key)
                                      if cuenta else None),
            "yape_qr": t["yape_qr"], "tenant": t["nombre"]}


@app.post("/api/payments/culqi/charge")
def culqi_charge(c: CulqiChargeIn):
    """Cargo REAL en Culqi sandbox: el token viene del checkout culqi.js y la
    verificación la hace el SERVIDOR contra la API de Culqi. Sin dinero real
    (llaves pk_test/sk_test), pero el flujo de verificación es el de producción.

    La secret sale de la cuenta Culqi DEL TENANT DEL PEDIDO (resuelta desde el
    pedido: el charge recibe {order_id, token}, y el order lleva tenant_id).
    FALLBACK: sin cuenta configurada se usa la env CULQI_SECRET_KEY — el
    comportamiento del prototipo original, una sola llave compartida por
    todos los locales. La public_key no hace falta aquí: culqi.js la usó en el
    navegador para tokenizar; el cargo solo exige la secret."""
    if c.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[c.order_id]
    modules.gates(o["tenant"], "pagos")  # gating real del módulo
    cuenta = payments.get_account(o["tenant"])
    sk = ((cuenta.secret_key if cuenta else "")
          or os.environ.get("CULQI_SECRET_KEY", ""))
    if not sk:
        raise HTTPException(400, "Sin CULQI_SECRET_KEY: no hay verificación real. "
                                 "Usa el cobro simulado del demo.")
    try:
        ch = payments.crear_cargo_culqi(sk, int(round(o["total"] * 100)), c.token)
    except payments.CulqiError as e:
        if e.code is not None:  # Culqi contestó con un error HTTP
            o["timeline"].append("culqi_rechazado")
            persist.order_write(o)  # write-through: el rechazo también persiste
            raise HTTPException(502, "Culqi rechazó el cargo: "
                                     f"{payments._culqi_error_message(e.body)}")
        raise HTTPException(502, f"No se pudo contactar a Culqi: {e.body}")
    exito = ch.get("outcome", {}).get("type") in ("venta_exitosa", "venta_exito") \
        or ch.get("status") == "successful"
    if exito:
        o["pago"] = "pagado_culqi_real"
        o["culqi_charge"] = ch.get("id", "")
        o["timeline"].append("pagado_culqi_real")
        persist.order_write(o)  # write-through
        ws.manager.broadcast("order.updated", o)
        return {"ok": True, "order": o, "charge_id": ch.get("id", ""),
                "motivo": ch.get("outcome", {}).get("user_message", "Venta exitosa.")}
    o["timeline"].append("culqi_rechazado")
    persist.order_write(o)  # write-through
    ws.manager.broadcast("order.updated", o)
    return {"ok": False, "order": o,
            "motivo": ch.get("outcome", {}).get("user_message", "Cargo rechazado")}


@app.post("/api/payments/culqi/webhook")
def culqi_wh(p: CulqiWHIn):
    # verificación server-to-server simulada: solo marca PAID si reference existe
    for o in store.ORDERS.values():
        if o.get("culqi_ref") == p.reference_id:
            modules.gates(o["tenant"], "pagos")  # gating real del módulo
            o["pago"] = "pagado_culqi"
            o["timeline"].append("pagado_culqi")
            persist.order_write(o)  # write-through: pago verificado
            ws.manager.broadcast("order.updated", o)
            return {"ok": True, "order": o}
    raise HTTPException(404, "reference?")

@app.post("/api/payments/yape")
def yape(p: YapeIn):
    if p.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[p.order_id]
    modules.gates(o["tenant"], "pagos")  # gating real del módulo
    v = logic.yape_verify(o["total"], p.monto_foto)
    o["pago"] = v["estado"]
    o["timeline"].append(v["estado"])
    persist.order_write(o)  # write-through: verificación Yape
    ws.manager.broadcast("order.updated", o)
    return {"order": o, **v}

@app.post("/api/demo/reset", dependencies=[Depends(get_current_user)])
def reset():
    store.reset_demo()
    ws.manager.broadcast("demo.reset")
    return {"ok": True, "n": len(store.ORDERS)}

# estáticos legacy (el frontend React en construcción los reemplazará)
app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "static")), name="static")

for route, fname in [("/", "index.html"), ("/chat", "chat.html"), ("/panel", "panel.html"), ("/cocina", "cocina.html"), ("/menu", "menu.html")]:
    def make_handler(f=fname):
        async def h():
            return FileResponse(os.path.join(ROOT, "static", f))
        return h
    app.get(route)(make_handler(fname))
