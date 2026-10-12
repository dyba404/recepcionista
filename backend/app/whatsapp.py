"""WhatsApp Meta Cloud API (modulos-mvp; plomería adaptada de los patrones de
Hainrixz/whatsapp-agentkit: verificación hub.challenge, firma X-Hub-Signature-256,
envío Graph API v21.0 con 1 retry, registro de suscripción webhook).

Sin canal configurado, todo cae a las variables de entorno Meta del .env
(python-dotenv); /api/whatsapp/setup guarda el canal en SQLite por tenant.

process_incoming es el punto único de entrada de mensajes de clientes para
TODOS los canales (whatsapp y demo): el inbox y el simulador legacy ven las
mismas conversaciones.
"""
import hashlib
import hmac
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlmodel import Session, select

from . import brain, data, ws
from .db import engine
from .deps import get_current_user, require_owner
from .models import (
    Conversation,
    Message,
    User,
    WhatsAppChannel,
    conversation_public,
    message_public,
)
from .modules import gates

log = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v21.0"

webhook_router = APIRouter(tags=["whatsapp-webhook"])   # público: lo llama Meta
router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


# ── Graph API (urllib, cero deps) ──

class GraphError(Exception):
    """Error HTTP de Graph API; body es el JSON (o texto crudo) de Meta."""

    def __init__(self, code: int | None, body: dict | str):
        super().__init__(f"Graph API {code}: {body}")
        self.code = code
        self.body = body


def graph_request(path: str, data: dict | None = None, method: str = "POST",
                  token: str = "", timeout: int = 30) -> dict:
    """Llamada a Graph API. GET pone data en el query string; POST form-encoded."""
    url = f"{GRAPH_URL}/{path}"
    if method == "GET" and data:
        url += "?" + urllib.parse.urlencode(data)
        data = None
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = raw
        raise GraphError(e.code, parsed) from None


def _graph_error_message(body: dict | str) -> str:
    if isinstance(body, dict):
        err = body.get("error", {})
        return str(err.get("message") or body)[:300]
    return str(body)[:300]


# ── canal por tenant ──

def get_channel(tenant: str, session: Session | None = None) -> WhatsAppChannel | None:
    if session is None:
        with Session(engine) as own:
            return get_channel(tenant, own)
    return session.exec(select(WhatsAppChannel).where(
        WhatsAppChannel.tenant_id == tenant)).first()


def _channel_public(ch: WhatsAppChannel) -> dict:
    """Forma segura de exponer el canal: JAMÁS el token."""
    return {"id": ch.id, "tenant_id": ch.tenant_id,
            "phone_number_id": ch.phone_number_id, "estado": ch.estado,
            "webhook_verified_at": (ch.webhook_verified_at.isoformat()
                                    if ch.webhook_verified_at else None)}


def send_whatsapp(tenant: str, to: str, text: str) -> dict:
    """POST {phone_number_id}/messages con el canal guardado (o env si no hay
    canal). Retry 1 vez ante errores de red o HTTP 5xx/429; los 4xx son
    permanentes (reintentar no cambia nada). Devuelve la respuesta de Graph
    ({"messaging_product", "contacts", "messages":[{"id"}]}); lanza si falla."""
    ch = get_channel(tenant)
    phone_number_id = ((ch.phone_number_id if ch else "")
                       or os.environ.get("META_PHONE_NUMBER_ID", ""))
    token = ((ch.token if ch else "")
             or os.environ.get("META_PERMANENT_TOKEN", ""))
    if not (phone_number_id and token):
        raise RuntimeError("Canal WhatsApp no configurado: usa /api/whatsapp/setup "
                           "o define META_PHONE_NUMBER_ID/META_PERMANENT_TOKEN")
    payload = {"messaging_product": "whatsapp", "to": to, "type": "text",
               "text": {"body": text}}
    last: Exception | None = None
    for _attempt in (1, 2):  # 1 retry, patrón whatsapp-agentkit
        try:
            return graph_request(f"{phone_number_id}/messages", data=payload,
                                 method="POST", token=token)
        except GraphError as e:
            if e.code is not None and 400 <= e.code < 500 and e.code != 429:
                raise
            last = e
        except Exception as e:  # red/DNS/timeout: reintenta
            last = e
    raise RuntimeError(f"WhatsApp Graph API falló tras 2 intentos: {last}") from last


# ── process_incoming: entrada única de mensajes de cliente (ambos canales) ──

def process_incoming(tenant: str, canal: str, wa_id: str, name: str, text: str,
                     cart: list | None = None) -> dict | None:
    """Mensaje entrante de un cliente → conversación + hilo + respuesta del bot.

    - Upsert Conversation por (tenant, canal, wa_id); "resuelta" se reabre a "bot".
    - unread +1 salvo en handoff (estado "humano": el operador la tiene abierta).
    - estado "humano" → NADA de bot (espera al operador).
    - estado "bot" → brain.reply → Message(role bot) → send_whatsapp si el canal
      es whatsapp. El canal demo NO envía: devuelve la respuesta al endpoint
      (/api/chat la responde al simulador).
    - Devuelve el result de brain.reply (reply/cart/next/...) o None si el
      humano tiene el control.

    NOTA: el carrito NO persiste por conversación en esta fase. Por WhatsApp
    llega cart=[] en cada mensaje (Meta no tiene estado de carrito) y el
    simulador demo pasa el suyo desde el request. Persistirlo es change posterior.
    """
    with Session(engine) as session:
        conv = session.exec(select(Conversation).where(
            Conversation.tenant_id == tenant, Conversation.canal == canal,
            Conversation.wa_id == wa_id)).first()
        if conv is None:
            conv = Conversation(tenant_id=tenant, canal=canal, wa_id=wa_id,
                                cliente=name or wa_id)
            session.add(conv)
            session.commit()
            session.refresh(conv)
        if conv.estado == "resuelta":
            conv.estado = "bot"  # cliente escribió de nuevo: reabrir
        msg = Message(conversation_id=conv.id, role="cliente", body=text)
        session.add(msg)
        conv.last_message_at = msg.created_at
        if conv.estado != "humano":
            conv.unread += 1
        session.add(conv)
        session.commit()
        session.refresh(msg)
        # misma forma que emite el inbox (con assigned_nombre): un solo contrato WS
        public = dict(conversation_public(conv))
        asig = session.get(User, conv.assigned_to) if conv.assigned_to else None
        public["assigned_nombre"] = asig.nombre if asig else None
        ws.manager.broadcast("conversation.updated", public, key="conversation")
        ws.manager.broadcast("message.created", message_public(msg), key="message")
        if conv.estado == "humano":
            return None  # handoff: el operador tiene el control, el bot espera
        result = brain.reply(tenant, wa_id, text, cart or [])
        reply_text = (result or {}).get("reply", "")
        if not reply_text:
            return result
        bot = Message(conversation_id=conv.id, role="bot", body=reply_text)
        session.add(bot)
        conv.last_message_at = bot.created_at
        session.add(conv)
        session.commit()
        session.refresh(bot)
        ws.manager.broadcast("message.created", message_public(bot), key="message")
        if canal == "whatsapp":
            try:
                send_whatsapp(tenant, wa_id, reply_text)
            except Exception:
                # la respuesta ya quedó en el hilo; un fallo de envío no debe
                # tumbar el webhook (Meta reintentaría todo el evento)
                log.exception("send_whatsapp falló para %s", wa_id)
        return result


# ── webhook Meta (público) ──

@webhook_router.get("/webhook/whatsapp")
def verify_webhook(hub_mode: str = Query(default="", alias="hub.mode"),
                   hub_verify_token: str = Query(default="", alias="hub.verify_token"),
                   hub_challenge: str = Query(default="", alias="hub.challenge")):
    """Verificación de suscripción: SOLO el challenge si el token coincide.
    Los nombres de query llevan punto ("hub.mode"): van con alias explícito."""
    expected = os.environ.get("META_VERIFY_TOKEN", "")
    if hub_mode == "subscribe" and expected and hub_verify_token == expected:
        _mark_webhook_verified()
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(403, "verify_token inválido")


def _mark_webhook_verified() -> None:
    """Deja huella del handshake para el wizard (canal del tenant faro)."""
    with Session(engine) as session:
        ch = get_channel("faro", session)
        if ch is None:
            pid = os.environ.get("META_PHONE_NUMBER_ID", "")
            tok = os.environ.get("META_PERMANENT_TOKEN", "")
            if not (pid and tok):
                return  # sin canal ni env: no hay dónde registrar la marca
            ch = WhatsAppChannel(tenant_id="faro", phone_number_id=pid, token=tok)
        ch.webhook_verified_at = datetime.now(timezone.utc)
        session.add(ch)
        session.commit()


@webhook_router.post("/webhook/whatsapp")
async def receive_webhook(request: Request):
    """Eventos de Meta: messages (solo texto en esta fase) y statuses (ack).

    Firma X-Hub-Signature-256 = "sha256="+HMAC(raw body, META_APP_SECRET),
    obligatoria si el header viene (en tests se puede omitir).
    """
    raw = await request.body()
    sig = request.headers.get("x-hub-signature-256")
    secret = os.environ.get("META_APP_SECRET", "")
    if sig is not None:
        expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(403, "Firma X-Hub-Signature-256 inválida")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "JSON inválido") from None
    # el bot puede tardar (LLM): fuera del event loop para no bloquear la app
    n = await run_in_threadpool(_handle_events, payload)
    return {"ok": True, "mensajes": n}


def _tenant_for(phone_number_id: str) -> str:
    """Un webhook, muchos locales: el phone_number_id del evento resuelve el
    tenant dueño del canal (WhatsAppChannel); sin canal configurado cae al
    default del env META_TENANT (o "faro", el número de la app del prototipo)."""
    if phone_number_id:
        with Session(engine) as session:
            ch = session.exec(select(WhatsAppChannel).where(
                WhatsAppChannel.phone_number_id == phone_number_id)).first()
            if ch is not None:
                return ch.tenant_id
    return os.environ.get("META_TENANT", "faro")


def _handle_events(payload: dict) -> int:
    """entry → changes → value → messages (text.body, from, profile name) + statuses.

    El tenant sale del metadata.phone_number_id de cada value (multi-tenant):
    cada número de WhatsApp conectado atiende a su propio local."""
    n = 0
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value", {}) or {}
            contacts = value.get("contacts", []) or []
            name = (contacts[0].get("profile", {}).get("name", "")
                    if contacts else "")
            metadata = value.get("metadata", {}) or {}
            tenant = _tenant_for(metadata.get("phone_number_id", ""))
            for msg in value.get("messages", []) or []:
                body = (msg.get("text") or {}).get("body")
                sender = msg.get("from")
                if not (body and sender):
                    continue  # imagen/audio/interactivos: change posterior
                process_incoming(tenant, canal="whatsapp", wa_id=sender,
                                 name=name, text=body)
                n += 1
            # value.statuses (sent/delivered/read): acknowledge, sin acción aún
    return n


# ── configuración del canal (owner) ──

class WhatsAppSetupIn(BaseModel):
    tenant: str
    phone_number_id: str | None = None
    token: str | None = None


class WebhookRegisterIn(BaseModel):
    tenant: str
    callback_url: str


class ConectarIn(BaseModel):
    tenant: str
    callback_url: str | None = None  # default: https://$CF_TUNNEL_HOSTNAME/webhook/whatsapp


def _check_tenant_owner(tenant: str, owner: User) -> None:
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    if owner.tenant_id != tenant:
        raise HTTPException(403, "Solo el dueño de este tenant puede configurarlo")


@router.post("/setup")
def whatsapp_setup(payload: WhatsAppSetupIn,
                   owner: User = Depends(require_owner)):
    """Guarda phone_number_id/token en WhatsAppChannel y marca estado conectado.
    Parciales: lo que no viene del wizard cae al env META_* o queda como estaba."""
    _check_tenant_owner(payload.tenant, owner)
    with Session(engine) as session:
        ch = get_channel(payload.tenant, session)
        if ch is None:
            pid = payload.phone_number_id or os.environ.get("META_PHONE_NUMBER_ID", "")
            tok = payload.token or os.environ.get("META_PERMANENT_TOKEN", "")
            if not (pid and tok):
                raise HTTPException(400, "Falta phone_number_id y token: pégalos "
                                         "en el wizard o define META_PHONE_NUMBER_ID/"
                                         "META_PERMANENT_TOKEN en el .env")
            ch = WhatsAppChannel(tenant_id=payload.tenant, phone_number_id=pid,
                                 token=tok)
        else:
            if payload.phone_number_id:
                ch.phone_number_id = payload.phone_number_id
            if payload.token:
                ch.token = payload.token
        ch.estado = "conectado"
        session.add(ch)
        session.commit()
        session.refresh(ch)
        return _channel_public(ch)


@router.post("/register-webhook")
def register_webhook(payload: WebhookRegisterIn,
                     owner: User = Depends(require_owner)):
    """Registra la suscripción en Graph API (POST /{app_id}/subscriptions).
    Meta devuelve error benigno si la callback ya estaba registrada: se normaliza."""
    gates(payload.tenant, "whatsapp")  # gating real del módulo (setup/status exentos)
    _check_tenant_owner(payload.tenant, owner)
    app_id = os.environ.get("META_APP_ID", "")
    app_secret = os.environ.get("META_APP_SECRET", "")
    if not (app_id and app_secret):
        raise HTTPException(400, "Falta META_APP_ID/META_APP_SECRET en el .env")
    data = {"object": "whatsapp", "callback_url": payload.callback_url,
            "verify_token": os.environ.get("META_VERIFY_TOKEN", ""),
            "fields": "messages"}
    try:
        result = graph_request(f"{app_id}/subscriptions", data=data, method="POST",
                               token=f"{app_id}|{app_secret}")
    except GraphError as e:
        msg = _graph_error_message(e.body)
        if "already" in msg.lower() or "#6203" in msg:
            return {"ok": True, "ya_registrada": True, "meta": e.body}
        raise HTTPException(502, f"Meta rechazó el registro del webhook: {msg}") from None
    return {"ok": True, "ya_registrada": False, "meta": result}


@router.post("/conectar")
def whatsapp_conectar(payload: ConectarIn,
                      owner: User = Depends(require_owner)):
    """Conexión de UN BOTÓN: la secuencia completa que costó una noche de debug
    (2026-10-11). La entrega de eventos de la Cloud API actual EXIGE la
    suscripción con object=whatsapp_business_account + campo "messages" (el
    object=whatsapp de la documentación NO recibe entregas) y además
    subscribed_apps en el WABA. Idempotente: cada paso es benigno re-hecho."""
    gates(payload.tenant, "whatsapp")
    _check_tenant_owner(payload.tenant, owner)
    app_id = os.environ.get("META_APP_ID", "")
    app_secret = os.environ.get("META_APP_SECRET", "")
    waba = os.environ.get("META_WABA_ID", "")
    token_permanente = os.environ.get("META_PERMANENT_TOKEN", "")
    verify_token = os.environ.get("META_VERIFY_TOKEN", "")
    hostname = os.environ.get("CF_TUNNEL_HOSTNAME", "").strip()
    callback = payload.callback_url or (
        f"https://{hostname}/webhook/whatsapp" if hostname else "")
    faltan = [k for k, v in {"META_APP_ID": app_id, "META_APP_SECRET": app_secret,
                             "META_WABA_ID": waba,
                             "META_PERMANENT_TOKEN": token_permanente,
                             "META_VERIFY_TOKEN": verify_token}.items() if not v]
    if faltan or not callback:
        raise HTTPException(400, f"Falta configurar en backend/.env: {', '.join(faltan)}"
                                 + ("" if callback else " — y callback_url o CF_TUNNEL_HOSTNAME"))
    pasos: list[dict] = []

    # 1) canal local (reusa el endpoint de setup con defaults del env)
    try:
        canal = whatsapp_setup(WhatsAppSetupIn(tenant=payload.tenant), owner)
        pasos.append({"paso": "canal", "ok": True,
                      "detalle": f"phone_number_id {canal['phone_number_id']}"})
    except HTTPException as e:
        pasos.append({"paso": "canal", "ok": False, "detalle": str(e.detail)})
        return {"ok": False, "pasos": pasos}

    # 2) la suscripción que REALMENTE recibe entregas + el campo messages
    try:
        graph_request(f"{app_id}/subscriptions", method="POST",
                      token=f"{app_id}|{app_secret}",
                      data={"object": "whatsapp_business_account",
                            "callback_url": callback,
                            "verify_token": verify_token,
                            "fields": "messages"})
        pasos.append({"paso": "suscripcion", "ok": True,
                      "detalle": f"whatsapp_business_account + messages → {callback}"})
    except GraphError as e:
        pasos.append({"paso": "suscripcion", "ok": False,
                      "detalle": _graph_error_message(e.body)})
        return {"ok": False, "pasos": pasos}

    # 3) fuera la suscripción con el objeto viejo (no recibe nada; confunde)
    try:
        graph_request(f"{app_id}/subscriptions?object=whatsapp", method="DELETE",
                      token=f"{app_id}|{app_secret}")
        pasos.append({"paso": "limpieza", "ok": True,
                      "detalle": "suscripción object=whatsapp eliminada"})
    except GraphError:
        pasos.append({"paso": "limpieza", "ok": True,
                      "detalle": "no había suscripción vieja"})

    # 4) el WABA debe tener la app suscrita para entregarle los eventos
    try:
        graph_request(f"{waba}/subscribed_apps", method="POST",
                      token=token_permanente, data={})
        pasos.append({"paso": "subscribed_apps", "ok": True,
                      "detalle": "el WABA entrega los eventos a esta app"})
    except GraphError as e:
        pasos.append({"paso": "subscribed_apps", "ok": False,
                      "detalle": _graph_error_message(e.body)})
        return {"ok": False, "pasos": pasos}

    # 5) verificación contra lo que Meta realmente tiene registrado
    activa, con_campo = _verificar_suscripcion(callback)
    pasos.append({"paso": "verificacion", "ok": activa and con_campo,
                  "detalle": ("suscripción activa con campo messages ✓"
                              if con_campo else "suscripción sin el campo messages")})
    return {"ok": all(p["ok"] for p in pasos), "pasos": pasos,
            "webhook_url_registrada": _registered_webhook_url()}


def _verificar_suscripcion(callback_url: str) -> tuple[bool, bool]:
    """(suscripción whatsapp_business_account activa con nuestro callback,
    tiene el campo messages). Best-effort: (False, False) si Meta no responde."""
    app_id = os.environ.get("META_APP_ID", "")
    app_secret = os.environ.get("META_APP_SECRET", "")
    try:
        result = graph_request(f"{app_id}/subscriptions", method="GET",
                               token=f"{app_id}|{app_secret}", timeout=10)
    except Exception:
        return False, False
    for sub in result.get("data", []) or []:
        if sub.get("object") == "whatsapp_business_account":
            activa = bool(sub.get("active")) and sub.get("callback_url") == callback_url
            con_campo = any(f.get("name") == "messages"
                            for f in sub.get("fields", []) or [])
            return activa, con_campo
    return False, False


@router.get("/status")
def whatsapp_status(tenant: str, user: User = Depends(get_current_user)):
    """Estado del canal + datos del wizard. SIN secret ni token en la respuesta
    (solo verify_token, que el dueño necesita pegar en Meta for Developers)."""
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    ch = get_channel(tenant)
    pid = ((ch.phone_number_id if ch else "")
           or os.environ.get("META_PHONE_NUMBER_ID", ""))
    return {"estado": ch.estado if ch else "desconectado",
            "phone_number_id": pid,
            "webhook_verified_at": (ch.webhook_verified_at.isoformat()
                                    if ch and ch.webhook_verified_at else None),
            "webhook_url_registrada": _registered_webhook_url(),
            "verify_token": os.environ.get("META_VERIFY_TOKEN", ""),
            "waba_id": os.environ.get("META_WABA_ID", ""),
            "app_id": os.environ.get("META_APP_ID", "")}


def _registered_webhook_url() -> str | None:
    """Best-effort: la callback_url registrada según Meta (GET subscriptions)."""
    app_id = os.environ.get("META_APP_ID", "")
    app_secret = os.environ.get("META_APP_SECRET", "")
    if not (app_id and app_secret):
        return None
    try:
        result = graph_request(f"{app_id}/subscriptions", method="GET",
                               token=f"{app_id}|{app_secret}", timeout=10)
        for sub in result.get("data", []) or []:
            # la que recibe entregas es whatsapp_business_account; la vieja
            # (object=whatsapp) es solo fallback visual del wizard
            if sub.get("object") == "whatsapp_business_account":
                return sub.get("callback_url")
        for sub in result.get("data", []) or []:
            if sub.get("object") == "whatsapp":
                return sub.get("callback_url")
    except Exception:
        return None
    return None
