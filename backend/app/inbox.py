"""Inbox con handoff humano (patrón Chatwoot en casa, modulos-mvp).

Todos los endpoints requieren Bearer y tienen el gate REAL del módulo inbox
(403 "Módulo desactivado..." si el owner lo apagó). El bot se pausa cuando la
conversación está en estado "humano": process_incoming ni lo consulta.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from . import data, ws
from .db import get_session
from .deps import get_current_user
from .models import CannedResponse, Conversation, Message, User, conversation_public, message_public
from .modules import gates
from .whatsapp import send_whatsapp

router = APIRouter(prefix="/api", tags=["inbox"])

NOTA_PREFIJO = "[nota interna] "


def _get_conv(session: Session, conv_id: int) -> Conversation:
    conv = session.get(Conversation, conv_id)
    if conv is None:
        raise HTTPException(404, "conversación?")
    gates(conv.tenant_id, "inbox", session)
    return conv


def _conv_full(session: Session, conv: Conversation) -> dict:
    """Forma pública + assigned_nombre (la misma que devuelve la lista)."""
    public = dict(conversation_public(conv))
    user = session.get(User, conv.assigned_to) if conv.assigned_to else None
    public["assigned_nombre"] = user.nombre if user else None
    return public


def _save_conv(session: Session, conv: Conversation) -> dict:
    """Commit + broadcast conversation.updated; devuelve la forma completa."""
    session.add(conv)
    session.commit()
    session.refresh(conv)
    public = _conv_full(session, conv)
    ws.manager.broadcast("conversation.updated", public, key="conversation")
    return public


# ── lista de conversaciones ──

@router.get("/conversations")
def list_conversations(tenant: str, estado: str | None = None,
                       solo_mias: bool = False, user_id: int | None = None,
                       user: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    gates(tenant, "inbox", session)
    q = select(Conversation).where(Conversation.tenant_id == tenant)
    if estado:
        q = q.where(Conversation.estado == estado)
    if solo_mias:
        q = q.where(Conversation.assigned_to == user.id)
    elif user_id is not None:
        q = q.where(Conversation.assigned_to == user_id)
    convs = session.exec(q.order_by(Conversation.last_message_at.desc())).all()

    # nombres de operadores asignados y último mensaje: 2 consultas, no N+1
    ids = [c.assigned_to for c in convs if c.assigned_to]
    nombres = {u.id: u.nombre for u in session.exec(
        select(User).where(User.id.in_(ids))).all()} if ids else {}
    conv_ids = [c.id for c in convs]
    last: dict[int, str] = {}
    if conv_ids:
        for m in session.exec(select(Message).where(
                Message.conversation_id.in_(conv_ids)).order_by(Message.id)).all():
            last[m.conversation_id] = m.body
    return [dict(conversation_public(c),
                 assigned_nombre=nombres.get(c.assigned_to),
                 last_body=last.get(c.id, ""))
            for c in convs]


@router.get("/conversations/{conv_id}/messages")
def list_messages(conv_id: int, user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)):
    _get_conv(session, conv_id)
    msgs = session.exec(select(Message).where(Message.conversation_id == conv_id)
                        .order_by(Message.id, Message.created_at)).all()
    return [message_public(m) for m in msgs]


# ── acciones de handoff ──

@router.post("/conversations/{conv_id}/takeover")
def takeover(conv_id: int, user: User = Depends(get_current_user),
             session: Session = Depends(get_session)):
    """El operador actual toma el control: el bot se pausa en esta conversación."""
    conv = _get_conv(session, conv_id)
    conv.assigned_to = user.id
    conv.estado = "humano"
    return _save_conv(session, conv)


@router.post("/conversations/{conv_id}/release")
def release(conv_id: int, user: User = Depends(get_current_user),
            session: Session = Depends(get_session)):
    """Devolver al bot: estado "bot" y sin asignado."""
    conv = _get_conv(session, conv_id)
    conv.estado = "bot"
    conv.assigned_to = None
    return _save_conv(session, conv)


@router.post("/conversations/{conv_id}/resolve")
def resolve(conv_id: int, user: User = Depends(get_current_user),
            session: Session = Depends(get_session)):
    conv = _get_conv(session, conv_id)
    conv.estado = "resuelta"
    return _save_conv(session, conv)


class AssignIn(BaseModel):
    user_id: int


@router.post("/conversations/{conv_id}/assign")
def assign(conv_id: int, payload: AssignIn,
           user: User = Depends(get_current_user),
           session: Session = Depends(get_session)):
    conv = _get_conv(session, conv_id)
    if session.get(User, payload.user_id) is None:
        raise HTTPException(404, "user?")
    conv.assigned_to = payload.user_id
    return _save_conv(session, conv)


class NoteIn(BaseModel):
    texto: str


@router.post("/conversations/{conv_id}/note")
def note(conv_id: int, payload: NoteIn,
         user: User = Depends(get_current_user),
         session: Session = Depends(get_session)):
    """Nota interna: queda en el hilo con prefijo, NUNCA se envía por WhatsApp."""
    conv = _get_conv(session, conv_id)
    msg = Message(conversation_id=conv.id, role="humano",
                  body=NOTA_PREFIJO + payload.texto)
    session.add(msg)
    session.commit()
    session.refresh(msg)
    public = message_public(msg)
    ws.manager.broadcast("message.created", public, key="message")
    return public


@router.post("/conversations/{conv_id}/read")
def mark_read(conv_id: int, user: User = Depends(get_current_user),
              session: Session = Depends(get_session)):
    conv = _get_conv(session, conv_id)
    conv.unread = 0
    return _save_conv(session, conv)


# ── composer del operador ──

class HumanMessageIn(BaseModel):
    body: str


@router.post("/conversations/{conv_id}/messages")
def send_human_message(conv_id: int, payload: HumanMessageIn,
                       user: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    """Mensaje del operador: se guarda SIEMPRE en el hilo; si la conversación
    es de WhatsApp se envía de verdad por Graph API (canal demo: solo guarda)."""
    conv = _get_conv(session, conv_id)
    msg = Message(conversation_id=conv.id, role="humano", body=payload.body)
    session.add(msg)
    conv.last_message_at = msg.created_at
    session.add(conv)
    session.commit()
    session.refresh(msg)
    public = message_public(msg)
    ws.manager.broadcast("message.created", public, key="message")
    ws.manager.broadcast("conversation.updated", _conv_full(session, conv),
                         key="conversation")
    if conv.canal == "whatsapp":
        try:
            send_whatsapp(conv.tenant_id, conv.wa_id, payload.body)
        except Exception as e:
            # el mensaje quedó en el hilo, pero el cliente NO lo recibió
            raise HTTPException(502, f"No se pudo enviar por WhatsApp: {e}") from None
    return public


# ── respuestas rápidas (canned) ──

class CannedIn(BaseModel):
    shortcut: str
    texto: str


@router.get("/canned")
def list_canned(tenant: str, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    gates(tenant, "inbox", session)
    return [{"id": c.id, "tenant_id": c.tenant_id, "shortcut": c.shortcut,
             "texto": c.texto}
            for c in session.exec(select(CannedResponse).where(
                CannedResponse.tenant_id == tenant).order_by(CannedResponse.id)).all()]


@router.post("/canned", status_code=201)
def create_canned(payload: CannedIn, tenant: str,
                  user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)):
    gates(tenant, "inbox", session)
    if not payload.shortcut.strip() or not payload.texto.strip():
        raise HTTPException(400, "shortcut y texto son obligatorios")
    row = CannedResponse(tenant_id=tenant, shortcut=payload.shortcut.strip(),
                         texto=payload.texto.strip())
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"id": row.id, "tenant_id": row.tenant_id, "shortcut": row.shortcut,
            "texto": row.texto}


@router.delete("/canned")
def delete_canned(tenant: str, id: int,
                  user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)):
    gates(tenant, "inbox", session)
    row = session.get(CannedResponse, id)
    if row is None or row.tenant_id != tenant:
        raise HTTPException(404, "canned?")
    session.delete(row)
    session.commit()
    return {"ok": True}
