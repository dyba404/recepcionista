"""Cuenta Culqi POR LOCAL (change pasarela-culqi): cada tenant guarda sus
propias llaves en SQLite (payment_account) y el backend valida la secret EN
VIVO contra Culqi antes de aceptarla.

Mismo patrón que el canal WhatsApp (whatsapp.py): upsert por tenant, secret
que JAMÁS sale del backend, y las llamadas HTTP extraídas en funciones
testeables (validar_secret_culqi / crear_cargo_culqi ↔ graph_request) para
que los tests las monkeypatéen sin tocar urllib.

El resto del flujo de pagos (links, webhook, yape) sigue en main.py; aquí
viven la cuenta, la validación y el cargo. main.py resuelve las llaves del
cargo desde aquí y cae a las env CULQI_* si el tenant no tiene cuenta.
"""
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from . import data
from .db import engine
from .deps import get_current_user, require_owner
from .models import PaymentAccount, User
from .modules import gates

CULQI_API = "https://api.culqi.com/v2"

router = APIRouter(prefix="/api/payments/cuenta", tags=["payments-cuenta"])


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


def _check_tenant_owner(tenant: str, owner: User) -> None:
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    if owner.tenant_id != tenant:
        raise HTTPException(403, "Solo el dueño de este tenant puede configurarlo")


# ── configuración de la cuenta (owner) ──

class CuentaIn(BaseModel):
    tenant: str
    public_key: str
    secret_key: str


@router.get("")
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


@router.post("")
def cuenta_setup(payload: CuentaIn, owner: User = Depends(require_owner)):
    """Guarda/actualiza la cuenta Culqi del local. La secret se valida EN VIVO
    contra Culqi (401 = rechazo → 400 con el mensaje); la public_key solo por
    formato (pk_test_/pk_live_), sin llamada. Upsert por tenant+provider;
    la respuesta lleva la public_key enmascarada, nunca la secret."""
    gates(payload.tenant, "pagos")  # gating real del módulo
    _check_tenant_owner(payload.tenant, owner)
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


@router.delete("")
def cuenta_delete(tenant: str, owner: User = Depends(require_owner)):
    """Borra la cuenta del local: el front cae a SIMULADO (config resuelve
    entonces desde las env CULQI_*, si existen). Idempotente: borrar sin
    cuenta también devuelve desconectada."""
    _check_tenant_owner(tenant, owner)
    with Session(engine) as session:
        a = get_account(tenant, session)
        if a is not None:
            session.delete(a)
            session.commit()
    return {"ok": True, "estado": "desconectada"}
