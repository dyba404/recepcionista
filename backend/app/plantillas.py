"""Plantillas WhatsApp (change endurecer-local, contrato D): espejo local +
Graph API de Meta, con lo que la API de test permite.

- GET /api/whatsapp/plantillas?tenant= (Bearer): las locales Y las de Meta
  (merge best-effort: GET /{WABA_ID}/message_templates con el token
  permanente; si Meta falla o falta el env, solo las locales).
- POST (manage_settings): crea en Meta (POST /{WABA_ID}/message_templates
  {name, language, category, components BODY text}) y guarda el espejo con
  el estado que Meta devolvió TAL CUAL — en test puede quedar
  "PENDING_APPROVAL" y se muestra tal cual (estados honestos). Sin env del
  WABA la plantilla nace "local" (espejo sin Meta).
- DELETE /{id}?tenant= (manage_settings): borra SOLO el espejo local.
- POST /enviar (manage_settings): "Enviar prueba" — sale por el MISMO send
  path de send_whatsapp (whatsapp.send_template, type=template) SIEMPRE al
  WHATSAPP_QA_RECIPIENT del .env (el número de test de la app; el campo
  telefono del payload se acepta por compatibilidad pero el contrato manda
  al QA). No exige que la plantilla exista en el espejo (hello_world de
  Meta no está en él): el que decide si puede enviarse es Meta, y su error
  viaja VERBATIM (502 con el mensaje de Meta).

Decisión de gating: sin gates de módulo (el contrato no lo pide); el
candado del frontend (manage_settings) se refleja en POST/DELETE/enviar,
y el GET queda solo-Bearer como /api/whatsapp/status.
"""
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import data, whatsapp
from .db import engine
from .deps import check_tenant_owner, get_current_user
from .models import User, WATemplate
from .roles import require_perm

router = APIRouter(prefix="/api/whatsapp/plantillas", tags=["plantillas"])


class PlantillaIn(BaseModel):
    """Alta: nombre [a-z0-9_] (lo que exige Meta, 422 con otra cosa),
    categoria/lenguaje Literals y cuerpo no vacío (con {{1}} variables)."""
    tenant: str
    nombre: str = Field(pattern=r"^[a-z0-9_]+$")
    categoria: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] = "MARKETING"
    lenguaje: Literal["es", "en"] = "es"
    cuerpo: str = Field(min_length=1)


class EnviarIn(BaseModel):
    tenant: str
    nombre: str
    lenguaje: Literal["es", "en"] = "es"
    telefono: str | None = None  # aceptado, pero el envío SIEMPRE sale al QA


def tpl_public(t: WATemplate) -> dict:
    return {"id": t.id, "tenant_id": t.tenant_id, "nombre": t.nombre,
            "lenguaje": t.lenguaje, "categoria": t.categoria,
            "estado": t.estado, "cuerpo": t.cuerpo, "meta_id": t.meta_id,
            "created_at": t.created_at.isoformat()}


def _locales(tenant: str) -> list[dict]:
    with Session(engine) as session:
        rows = session.exec(select(WATemplate).where(
            WATemplate.tenant_id == tenant).order_by(WATemplate.id)).all()
    return [tpl_public(r) for r in rows]


def _cuerpo_de(mt: dict) -> str:
    """El texto del componente BODY de una plantilla de Meta ("" si no lo
    trae). Best-effort: el merge no debe romper por una forma rara."""
    for c in mt.get("components", []) or []:
        if isinstance(c, dict) and c.get("type") == "BODY":
            return str(c.get("text", ""))
    return ""


def _meta_plantillas() -> list[dict]:
    """Las plantillas de Meta via Graph (token permanente): BEST-EFFORT —
    sin env del WABA, red caída o error HTTP devuelve [] y el listado cae a
    solo locales (contrato D)."""
    waba = os.environ.get("META_WABA_ID", "")
    token = os.environ.get("META_PERMANENT_TOKEN", "")
    if not (waba and token):
        return []
    try:
        resp = whatsapp.graph_request(f"{waba}/message_templates",
                                      method="GET", token=token, timeout=15)
    except Exception:
        return []
    return resp.get("data", []) or []


@router.get("")
def listar(tenant: str, user: User = Depends(get_current_user)):
    if tenant not in data.TENANTS:
        raise HTTPException(404, "tenant?")
    por_nombre = {t["nombre"]: t for t in _locales(tenant)}
    for mt in _meta_plantillas():
        nombre = str(mt.get("name") or "")
        if not nombre:
            continue
        entry = por_nombre.setdefault(nombre, {
            "id": None, "tenant_id": tenant, "nombre": nombre,
            "lenguaje": str(mt.get("language") or ""),
            "categoria": str(mt.get("category") or ""),
            "estado": "", "cuerpo": _cuerpo_de(mt),
            "meta_id": mt.get("id"), "created_at": None})
        # el estado de Meta es el vivo: manda sobre el espejo local
        entry["estado"] = str(mt.get("status") or entry["estado"])
        entry["meta_id"] = mt.get("id") or entry.get("meta_id")
    return list(por_nombre.values())


@router.post("", status_code=201)
def crear(payload: PlantillaIn,
          user: User = Depends(require_perm("manage_settings"))):
    check_tenant_owner(payload.tenant, user)
    waba = os.environ.get("META_WABA_ID", "")
    token = os.environ.get("META_PERMANENT_TOKEN", "")
    data_meta = {"name": payload.nombre, "language": payload.lenguaje,
                 "category": payload.categoria,
                 "components": [{"type": "BODY", "text": payload.cuerpo}]}
    meta_resp = None
    if not (waba and token):
        # sin credenciales del WABA no hay creación en Meta: la plantilla
        # queda como espejo "local" (se sube cuando el canal esté completo)
        estado, meta_id = "local", None
    else:
        try:
            meta_resp = whatsapp.graph_request(
                f"{waba}/message_templates", data=data_meta, method="POST",
                token=token)
        except whatsapp.GraphError as e:
            raise HTTPException(
                502, "Meta rechazó crear la plantilla: "
                f"{whatsapp._graph_error_message(e.body)}") from None
        # el status de Meta TAL CUAL ("PENDING_APPROVAL", "APPROVED", …)
        estado = str(meta_resp.get("status") or "en_revision")
        meta_id = meta_resp.get("id")
    row = WATemplate(tenant_id=payload.tenant, nombre=payload.nombre,
                     lenguaje=payload.lenguaje, categoria=payload.categoria,
                     estado=estado, cuerpo=payload.cuerpo, meta_id=meta_id)
    with Session(engine) as session:
        session.add(row)
        session.commit()
        session.refresh(row)
    d = tpl_public(row)
    d["meta"] = meta_resp  # la respuesta de Meta tal cual (estados honestos)
    if estado == "local":
        d["nota"] = ("Guardada localmente: falta META_WABA_ID/"
                     "META_PERMANENT_TOKEN en el .env — súbela a Meta cuando "
                     "configures el canal")
    return d


@router.delete("/{tpl_id}")
def borrar(tpl_id: int, tenant: str,
           user: User = Depends(require_perm("manage_settings"))):
    """Borra SOLO el espejo local (la plantilla de Meta, si llegó a existir,
    se gestiona en Meta for Developers)."""
    check_tenant_owner(tenant, user)
    with Session(engine) as session:
        row = session.get(WATemplate, tpl_id)
        if row is None or row.tenant_id != tenant:
            raise HTTPException(404, "Plantilla no encontrada")
        session.delete(row)
        session.commit()
    return {"ok": True}


@router.post("/enviar")
def enviar_prueba(payload: EnviarIn,
                  user: User = Depends(require_perm("manage_settings"))):
    check_tenant_owner(payload.tenant, user)
    qa = os.environ.get("WHATSAPP_QA_RECIPIENT", "")
    if not qa:
        raise HTTPException(400, "Falta WHATSAPP_QA_RECIPIENT en el .env "
                                 "(el número de test de la app)")
    try:
        resp = whatsapp.send_template(payload.tenant, qa, payload.nombre,
                                      payload.lenguaje)
    except whatsapp.GraphError as e:
        # error de Meta VERBATIM (contrato): es el que explica por qué no
        raise HTTPException(502, whatsapp._graph_error_message(e.body)) from None
    except Exception as e:  # canal sin configurar / red: mensaje honesto
        raise HTTPException(502, str(e)) from None
    return {"ok": True, "enviado_a": qa, "meta": resp}
