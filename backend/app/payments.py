"""Pagos: cuenta Culqi POR LOCAL (pasarela-culqi) + flujos de cobro con
ledger (saas-cola-2).

Cada tenant guarda sus llaves Culqi en SQLite (payment_account); el backend
valida la secret EN VIVO contra Culqi antes de aceptarla. Mismo patrón que
el canal WhatsApp: upsert por tenant, secret que JAMÁS sale del backend, y
las llamadas HTTP extraídas en funciones testeables (validar_secret_culqi /
crear_cargo_culqi ↔ graph_request) para que los tests las monkeypatéen sin
tocar urllib.

Los flujos de cobro (link, webhook simulado, charge real, Yape) vivían en
main.py; ahora están aquí, y cada uno escribe UNA fila en el ledger
(tabla payment): culqi_real verificado/rechazado, culqi_simulado verificado,
yape verificado/pendiente_verificar.
"""
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from . import data, logic, persist, store, ws
from .db import engine, get_session
from .deps import check_tenant_owner, get_current_user, require_owner
from .models import Payment, PaymentAccount, User
from .modules import gates
from .roles import require_perm
from .schemas import CulqiChargeIn, CulqiLinkIn, CulqiWHIn, YapeIn
from .tenants import qr_path

CULQI_API = "https://api.culqi.com/v2"

router = APIRouter(prefix="/api/payments", tags=["payments"])


# ── API Culqi (urllib, cero deps — patrón graph_request de whatsapp.py) ──

class CulqiError(Exception):
    """Error hablando con Culqi. code None = no se pudo contactar
    (timeout/DNS/red); body es el JSON (dict) o el texto crudo de Culqi."""

    def __init__(self, code: int | None, body: dict | str):
        super().__init__(f"Culqi {code}: {body}")
        self.code = code
        self.body = body


def _culqi_error_message(body: dict | str) -> str:
    """Mensaje humano del error de Culqi: merchant_message (el que le habla
    al comercio) > user_message > message > el crudo, recortado a 300."""
    if isinstance(body, dict):
        for k in ("merchant_message", "user_message", "message"):
            if body.get(k):
                return str(body[k])[:300]
        err = body.get("error", {})
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:300]
    return str(body)[:300]


def _parse_error_body(raw: str) -> dict | str:
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def validar_secret_culqi(sk: str, timeout: int = 15) -> tuple[bool, str]:
    """Valida la llave secreta EN VIVO: GET charges?limit=1 con Bearer.

    - 200 (lista vacía incluida: cuenta recién creada sin cargos) → (True, "").
    - 401 → (False, mensaje de Culqi): llave mala.
    - Timeout/5xx/otro HTTP → CulqiError: Culqi no está disponible para
      validar y el endpoint lo traduce a un 502 honesto (no a un falso 400).
    """
    req = urllib.request.Request(f"{CULQI_API}/charges?limit=1", method="GET",
                                 headers={"Authorization": f"Bearer {sk}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return True, ""
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        if e.code == 401:
            return False, _culqi_error_message(_parse_error_body(raw))
        raise CulqiError(e.code, _parse_error_body(raw)) from None
    except Exception as e:  # timeout/DNS/red: Culqi no contesta
        raise CulqiError(None, str(e)) from None


def crear_cargo_culqi(sk: str, monto_centavos: int, token: str,
                      email: str = "cliente@demo.pe", timeout: int = 30) -> dict:
    """POST /v2/charges con la secret indicada (la del tenant o la del env).
    Devuelve el JSON del cargo; lanza CulqiError (code HTTP o None si no hubo
    respuesta). El monto va en centavos, como exige Culqi."""
    body = json.dumps({"amount": monto_centavos, "currency_code": "PEN",
                       "email": email, "source_id": token}).encode()
    req = urllib.request.Request(f"{CULQI_API}/charges", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {sk}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        raise CulqiError(e.code, _parse_error_body(raw)) from None
    except Exception as e:  # timeout/DNS/red
        raise CulqiError(None, str(e)) from None


# ── ledger (saas-cola-2): UNA fila por acción de pago ──

def ledger_write(tenant_id: str, order_id: str, gateway: str, estado: str,
                 monto: float, referencia: str = "", detalle: str = "") -> None:
    """Registra la acción de pago. Comisión: la tasa del local para Culqi,
    0 para Yape (transferencia directa, sin pasarela)."""
    comision = 0.0
    if gateway != "yape":
        comision = round(monto * data.TENANTS.get(
            tenant_id, {}).get("culqi_comision", 0.0344), 2)
    with Session(engine) as session:
        session.add(Payment(tenant_id=tenant_id, order_id=order_id,
                            gateway=gateway, referencia=referencia,
                            monto=monto, comision=comision, estado=estado,
                            detalle=detalle))
        session.commit()


def payment_public(p: Payment) -> dict:
    return {"id": p.id, "tenant_id": p.tenant_id, "order_id": p.order_id,
            "gateway": p.gateway, "referencia": p.referencia,
            "monto": p.monto, "comision": p.comision, "estado": p.estado,
            "detalle": p.detalle, "created_at": p.created_at.isoformat()}


@router.get("/ledger")
def ledger(tenant: str, user: User = Depends(require_perm("view_ledger")),
           session: Session = Depends(get_session)):
    """Historial de pagos del local (owner+admin: capacidad view_ledger,
    change roles-equipo): últimos 100, el más reciente primero."""
    check_tenant_owner(tenant, user)
    rows = session.exec(select(Payment).where(Payment.tenant_id == tenant)
                        .order_by(Payment.id.desc()).limit(100)).all()
    return [payment_public(p) for p in rows]


# ── cuenta por tenant ──

def get_account(tenant: str,
                session: Session | None = None) -> PaymentAccount | None:
    """La cuenta de pago del tenant (proveedor culqi)."""
    if session is None:
        with Session(engine) as own:
            return get_account(tenant, own)
    return session.exec(select(PaymentAccount).where(
        PaymentAccount.tenant_id == tenant,
        PaymentAccount.provider == "culqi")).first()


def enmascarar_pk(pk: str) -> str:
    """Public key enmascarada para respuestas: primeros 8 + "…" (pk_test_…)."""
    return pk[:8] + "…"


def _account_public(a: PaymentAccount) -> dict:
    """Forma segura de exponer la cuenta: JAMÁS la secret."""
    return {"estado": a.estado,
            "public_key": enmascarar_pk(a.public_key),
            "verified_at": (a.verified_at.isoformat()
                            if a.verified_at else None),
            "provider": a.provider}


# ── configuración de la cuenta (owner) ──

class CuentaIn(BaseModel):
    tenant: str
    public_key: str
    secret_key: str


@router.get("/cuenta")
def cuenta_status(tenant: str, user: User = Depends(get_current_user)):
    """Estado de la cuenta Culqi del local (Bearer, como whatsapp /status).
    La public_key viaja ENMASCARADA y la secret jamás."""
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    a = get_account(tenant)
    if a is None:
        return {"estado": "desconectada", "public_key": None,
                "verified_at": None, "provider": "culqi"}
    return _account_public(a)


@router.post("/cuenta")
def cuenta_setup(payload: CuentaIn, owner: User = Depends(require_owner)):
    """Guarda/actualiza la cuenta Culqi del local. La secret se valida EN VIVO
    contra Culqi (401 = rechazo → 400 con el mensaje); la public_key solo por
    formato (pk_test_/pk_live_), sin llamada. Upsert por tenant+provider;
    la respuesta lleva la public_key enmascarada, nunca la secret."""
    gates(payload.tenant, "pagos")  # gating real del módulo
    check_tenant_owner(payload.tenant, owner)
    pk, sk = payload.public_key.strip(), payload.secret_key.strip()
    if not (pk.startswith("pk_test_") or pk.startswith("pk_live_")):
        raise HTTPException(400, "public_key inválida: debe empezar con "
                                   "pk_test_ o pk_live_")
    if not sk:
        raise HTTPException(400, "Falta la secret_key")
    try:
        valida, mensaje = validar_secret_culqi(sk)
    except CulqiError as e:
        detalle = (_culqi_error_message(e.body) if e.code is not None
                   else str(e.body))
        raise HTTPException(502, f"No se pudo validar la llave con Culqi: "
                                 f"{detalle}") from None
    if not valida:
        raise HTTPException(400, f"Llave secreta rechazada por Culqi: {mensaje}")
    with Session(engine) as session:
        a = get_account(payload.tenant, session)
        if a is None:
            a = PaymentAccount(tenant_id=payload.tenant, provider="culqi",
                               public_key=pk, secret_key=sk)
        else:  # upsert: el local ya tenía cuenta, se reemplazan las llaves
            a.public_key, a.secret_key = pk, sk
        a.estado = "conectada"
        a.verified_at = datetime.now(timezone.utc)
        session.add(a)
        session.commit()
        session.refresh(a)
        return _account_public(a)


@router.delete("/cuenta")
def cuenta_delete(tenant: str, owner: User = Depends(require_owner)):
    """Borra la cuenta del local: el front cae a SIMULADO (config resuelve
    entonces desde las env CULQI_*, si existen). Idempotente: borrar sin
    cuenta también devuelve desconectada."""
    check_tenant_owner(tenant, owner)
    with Session(engine) as session:
        a = get_account(tenant, session)
        if a is not None:
            session.delete(a)
            session.commit()
    return {"ok": True, "estado": "desconectada"}


# ── flujos de cobro (ex main.py) ──

@router.post("/culqi/link")
def culqi_link(p: CulqiLinkIn):
    gates(p.tenant, "pagos")  # gating real del módulo
    if p.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[p.order_id]
    link = logic.culqi_link(p.tenant, p.order_id, o["total"])
    o["culqi_ref"] = link["reference_id"]
    o["timeline"].append("link_culqi")
    persist.order_write(o)  # write-through: culqi_ref + timeline
    return link


@router.get("/config")
def pay_config(tenant: str):
    """Qué puede ofrecer el front: Culqi REAL por LOCAL (la cuenta del tenant,
    con su pk completa para culqi.js) o SIMULADO (caída a la env CULQI_PUBLIC_KEY
    del prototipo, una sola cuenta compartida). yape_qr_imagen dice si el local
    subió su QR real (el front lo muestra en vez del QR generado)."""
    t = data.TENANTS.get(tenant)
    if not t:
        raise HTTPException(404, "tenant?")
    gates(tenant, "pagos")  # gating real del módulo
    cuenta = get_account(tenant)
    return {"culqi_pk": (cuenta.public_key if cuenta
                         else os.environ.get("CULQI_PUBLIC_KEY", "")),
            "culqi_estado": "conectada" if cuenta else "simulada",
            "culqi_pk_enmascarada": (enmascarar_pk(cuenta.public_key)
                                      if cuenta else None),
            "yape_qr": t["yape_qr"], "tenant": t["nombre"],
            "yape_qr_imagen": qr_path(tenant).is_file()}


@router.post("/culqi/charge")
def culqi_charge(c: CulqiChargeIn):
    """Cargo REAL en Culqi sandbox: el token viene del checkout culqi.js y la
    verificación la hace el SERVIDOR contra la API de Culqi. Sin dinero real
    (llaves pk_test/sk_test), pero el flujo de verificación es el de producción.

    La secret sale de la cuenta Culqi DEL TENANT DEL PEDIDO (resuelta desde
    el pedido: el charge recibe {order_id, token}, y el order lleva tenant_id).
    FALLBACK: sin cuenta configurada se usa la env CULQI_SECRET_KEY — el
    comportamiento del prototipo original, una sola llave compartida por
    todos los locales. La public_key no hace falta aquí: culqi.js la usó en el
    navegador para tokenizar; el cargo solo exige la secret."""
    if c.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[c.order_id]
    gates(o["tenant"], "pagos")  # gating real del módulo
    cuenta = get_account(o["tenant"])
    sk = ((cuenta.secret_key if cuenta else "")
          or os.environ.get("CULQI_SECRET_KEY", ""))
    if not sk:
        raise HTTPException(400, "Sin CULQI_SECRET_KEY: no hay verificación real. "
                                 "Usa el cobro simulado del demo.")
    try:
        ch = crear_cargo_culqi(sk, int(round(o["total"] * 100)), c.token)
    except CulqiError as e:
        if e.code is not None:  # Culqi contestó con un error HTTP
            o["timeline"].append("culqi_rechazado")
            persist.order_write(o)  # write-through: el rechazo también persiste
            ledger_write(o["tenant"], c.order_id, "culqi_real", "rechazado",
                         o["total"], detalle=_culqi_error_message(e.body))
            raise HTTPException(502, "Culqi rechazó el cargo: "
                                     f"{_culqi_error_message(e.body)}")
        raise HTTPException(502, f"No se pudo contactar a Culqi: {e.body}")
    exito = ch.get("outcome", {}).get("type") in ("venta_exitosa", "venta_exito") \
        or ch.get("status") == "successful"
    if exito:
        o["pago"] = "pagado_culqi_real"
        o["culqi_charge"] = ch.get("id", "")
        o["timeline"].append("pagado_culqi_real")
        persist.order_write(o)  # write-through
        ledger_write(o["tenant"], c.order_id, "culqi_real", "verificado",
                     o["total"], referencia=ch.get("id", ""),
                     detalle=ch.get("outcome", {}).get("user_message",
                                                       "Venta exitosa."))
        ws.manager.broadcast("order.updated", o)
        return {"ok": True, "order": o, "charge_id": ch.get("id", ""),
                "motivo": ch.get("outcome", {}).get("user_message", "Venta exitosa.")}
    o["timeline"].append("culqi_rechazado")
    persist.order_write(o)  # write-through
    ledger_write(o["tenant"], c.order_id, "culqi_real", "rechazado",
                 o["total"], detalle=ch.get("outcome", {}).get("user_message",
                                                                "Cargo rechazado"))
    ws.manager.broadcast("order.updated", o)
    return {"ok": False, "order": o,
            "motivo": ch.get("outcome", {}).get("user_message", "Cargo rechazado")}


@router.post("/culqi/webhook")
def culqi_wh(p: CulqiWHIn):
    # verificación server-to-server simulada: solo marca PAID si reference existe
    for o in store.ORDERS.values():
        if o.get("culqi_ref") == p.reference_id:
            gates(o["tenant"], "pagos")  # gating real del módulo
            o["pago"] = "pagado_culqi"
            o["timeline"].append("pagado_culqi")
            persist.order_write(o)  # write-through: pago verificado
            ledger_write(o["tenant"], o["id"], "culqi_simulado", "verificado",
                         o["total"], referencia=p.reference_id,
                         detalle="Pago verificado por webhook simulado")
            ws.manager.broadcast("order.updated", o)
            return {"ok": True, "order": o}
    raise HTTPException(404, "reference?")


@router.post("/yape")
def yape(p: YapeIn):
    if p.order_id not in store.ORDERS:
        raise HTTPException(404, "pedido?")
    o = store.ORDERS[p.order_id]
    gates(o["tenant"], "pagos")  # gating real del módulo
    v = logic.yape_verify(o["total"], p.monto_foto)
    o["pago"] = v["estado"]
    o["timeline"].append(v["estado"])
    persist.order_write(o)  # write-through: verificación Yape
    ledger_write(o["tenant"], o["id"], "yape",
                 "verificado" if v["ok"] else "pendiente_verificar",
                 o["total"], detalle=v["motivo"])
    ws.manager.broadcast("order.updated", o)
    return {"order": o, **v}
