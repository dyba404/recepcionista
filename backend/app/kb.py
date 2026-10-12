"""Base de conocimiento del local (change carta-inventario-bot): el "RAG"
de verdad — entradas temáticas (horarios, ubicación, promos) que el NLU
responde determinista (HORARIO_W/UBICACION_W en logic.py) y el prompt del
LLM lleva como bloque "INFORMACION DEL LOCAL" (brain.context_block).

CRUD /api/kb: GET lista (Bearer, del propio local), POST crea
(manage_settings), PATCH edita {tema?, contenido?, activo?}, DELETE borra
(?tenant=, manage_settings). Respuestas sin secreto: esta tabla no guarda
ninguno (solo contenido público del local).

kb_entries() es la fuente que leen brain/logic: try/except con [] para que
el prompt y el NLU nunca se rompan si la tabla faltara (init_db la crea, y
la migración de db.py cuida las columnas nuevas de tablas viejas).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .db import engine, get_session
from .deps import check_tenant_owner, get_current_user
from .models import KnowledgeEntry, User
from .roles import require_perm
from .schemas import KBCreateIn, KBPatchIn

router = APIRouter(prefix="/api/kb", tags=["kb"])


def kb_entries(tenant: str, solo_activas: bool = True) -> list[KnowledgeEntry]:
    """Entradas del local (activas por defecto), orden de creación estable."""
    try:
        with Session(engine) as session:
            stmt = select(KnowledgeEntry).where(
                KnowledgeEntry.tenant_id == tenant)
            if solo_activas:
                stmt = stmt.where(KnowledgeEntry.activo == True)  # noqa: E712
            return session.exec(stmt.order_by(KnowledgeEntry.id)).all()
    except Exception:
        return []  # sin tabla/BD: el bot responde sin KB (honesto), no revienta


def kb_public(e: KnowledgeEntry) -> dict:
    return {"id": e.id, "tenant_id": e.tenant_id, "tema": e.tema,
            "contenido": e.contenido, "activo": e.activo,
            "created_at": e.created_at.isoformat()}


def _get_entry(session: Session, entry_id: int) -> KnowledgeEntry:
    e = session.get(KnowledgeEntry, entry_id)
    if e is None:
        raise HTTPException(404, "Entrada no encontrada")
    return e


@router.get("")
def list_kb(tenant: str, user: User = Depends(get_current_user),
            session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)  # Bearer + del propio local
    filas = session.exec(select(KnowledgeEntry).where(
        KnowledgeEntry.tenant_id == tenant).order_by(KnowledgeEntry.id)).all()
    return [kb_public(e) for e in filas]


@router.post("", status_code=201)
def create_entry(payload: KBCreateIn,
                 user: User = Depends(require_perm("manage_settings")),
                 session: Session = Depends(get_session)):
    check_tenant_owner(payload.tenant, user)
    e = KnowledgeEntry(tenant_id=payload.tenant, tema=payload.tema.strip(),
                       contenido=payload.contenido.strip(), activo=payload.activo)
    session.add(e)
    session.commit()
    session.refresh(e)
    return kb_public(e)


@router.patch("/{entry_id}")
def patch_entry(entry_id: int, payload: KBPatchIn,
                user: User = Depends(require_perm("manage_settings")),
                session: Session = Depends(get_session)):
    """Edición por id: el tenant se deduce de la PROPIA entrada (la ruta del
    contrato no lleva ?tenant=) y check_tenant_owner cercena cruces."""
    e = _get_entry(session, entry_id)
    check_tenant_owner(e.tenant_id, user)
    if payload.tema is not None:
        e.tema = payload.tema.strip()
    if payload.contenido is not None:
        e.contenido = payload.contenido.strip()
    if payload.activo is not None:
        e.activo = payload.activo
    session.add(e)
    session.commit()
    session.refresh(e)
    return kb_public(e)


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, tenant: str,
                 user: User = Depends(require_perm("manage_settings")),
                 session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    e = _get_entry(session, entry_id)
    if e.tenant_id != tenant:
        raise HTTPException(404, "Esa entrada no es de este local")
    session.delete(e)
    session.commit()
    return {"ok": True}
