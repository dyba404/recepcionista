"""Bot configurable / "Asistente" (change carta-inventario-bot).

Tabla bot_config (una fila por local) + GET/PUT /api/botconfig. El patrón es
el del asistente de Chatwoot: el dueño configura campos SEGUROS (nombre,
saludo, tono, instrucciones extra) que el bot AÑADE a las reglas del sistema
— las REGLAS (anti-fraude, sin cocina/reservas, sin inventar) viven en
brain.context_block y NO son configurables por diseño: si el dueño pudiera
reescribirlas, un prompt malicioso o descuidado desarmaría la verificación
de pagos. Las instrucciones_extra entran al prompt DESPUÉS de las reglas,
marcadas como "extras, sin contradecir las REGLAS".

DECISIÓN de caching: SIN cache a propósito. bot_config() consulta directa la
fila y cae a defaults si no hay (o si la tabla faltara: try/except — el
prompt y el NLU nunca se rompen por configuración). La invalidación queda
gratis: el PUT es visible en el siguiente mensaje sin llevar updated_at
en la key. El costo es un SELECT por tenant en los mensajes que arman
prompt (el local es chico; la tabla es una fila por local).

horarios-pausa-notif-perfil añade el switch pausado (auto-respuesta
out-of-office): bot_pausado() lo lee aparte (ver su docstring) y el PATCH
/api/botconfig {pausado} es el toggle dedicado de la UI.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlmodel import Session

from . import data
from .db import engine, get_session
from .deps import check_tenant_owner, get_current_user
from .models import BotConfig, User
from .roles import require_perm
from .schemas import BotConfigPatchIn, BotConfigPutIn

router = APIRouter(prefix="/api/botconfig", tags=["bot"])

# nombres actuales de los bots seed (antes logic.BOTS): el fallback cuando
# el tenant no tiene fila. Tenant nuevo sin fila → "FaroBot" como siempre.
DEFAULT_NOMBRES = {"faro": "FaroBot", "brasa": "BrasaBot", "juana": "JuanaBot"}
DEFAULT_TONO = "cercano"


def bot_config(tenant: str) -> dict:
    """Config EFECTIVA del bot para brain/logic: fila si existe, defaults si
    no. nombre_bot/saludo en None significa "usa el default del caller"
    (BOTS del tenant para el nombre; saludo del tenant para menu_text)."""
    try:
        with Session(engine) as session:
            row = session.get(BotConfig, tenant)
    except Exception:
        row = None  # tabla inexistente/BD caída: el bot sigue con defaults
    if row is None:
        return {"nombre_bot": None, "saludo": None, "tono": DEFAULT_TONO,
                "instrucciones_extra": ""}
    return {"nombre_bot": row.nombre_bot or None, "saludo": row.saludo or None,
            "tono": row.tono or DEFAULT_TONO,
            "instrucciones_extra": row.instrucciones_extra or ""}


def nombre_bot(tenant: str) -> str:
    """Nombre con el que el bot se presenta (identity + prompt del LLM)."""
    return (bot_config(tenant)["nombre_bot"]
            or DEFAULT_NOMBRES.get(tenant, "FaroBot"))


def bot_pausado(tenant: str) -> bool:
    """Pausa TOTAL del bot (horarios-pausa-notif-perfil, parte B): True →
    brain.reply contesta la fija de "te atiende el equipo" y NO corre NLU de
    pedido, KB ni LLM. Lectura SEPARADA de bot_config() a propósito: ese dict
    es un contrato probado con igualdad exacta (tests de config) y la pausa es
    un gate de control, no un campo de redacción. Tabla/BD caídas → False: sin
    pausa (fail-open), el bot nunca se calla por configuración ilegible."""
    try:
        with Session(engine) as session:
            row = session.get(BotConfig, tenant)
    except Exception:
        return False
    return bool(row.pausado) if row else False


def _config_public(tenant: str, row: BotConfig | None) -> dict:
    """Respuesta GET/PUT/PATCH: valores efectivos (lo que el bot usa de verdad),
    sin ningún secreto — esta tabla no guarda ninguno. pausado (change
    horarios-pausa-notif-perfil) viaja para el switch "Asistente pausado"."""
    cfg = bot_config(tenant)
    return {"tenant": tenant,
            "nombre_bot": cfg["nombre_bot"] or DEFAULT_NOMBRES.get(tenant, "FaroBot"),
            "saludo": cfg["saludo"] or data.TENANTS[tenant]["saludo"],
            "tono": cfg["tono"],
            "instrucciones_extra": cfg["instrucciones_extra"],
            "pausado": bot_pausado(tenant),
            "updated_at": (row.updated_at.isoformat() if row else None)}


@router.get("")
def get_config(tenant: str, user: User = Depends(get_current_user),
               session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)  # Bearer + del propio local
    row = session.get(BotConfig, tenant)
    return _config_public(tenant, row)


@router.put("")
def put_config(payload: BotConfigPutIn,
               user: User = Depends(require_perm("manage_settings")),
               session: Session = Depends(get_session)):
    """Guarda el Asistente (upsert): los campos ausentes quedan como están,
    updated_at siempre se toca (marca de "cambió algo"). pausado ausente →
    queda como está (PUT parcial, igual que el resto de campos)."""
    check_tenant_owner(payload.tenant, user)
    row = session.get(BotConfig, payload.tenant)
    if row is None:  # primer save de un local sin fila
        row = BotConfig(tenant_id=payload.tenant,
                       nombre_bot=DEFAULT_NOMBRES.get(payload.tenant, "FaroBot"),
                       saludo=data.TENANTS[payload.tenant]["saludo"])
    if payload.nombre_bot is not None:
        row.nombre_bot = payload.nombre_bot.strip()
    if payload.saludo is not None:
        row.saludo = payload.saludo.strip()
    if payload.tono is not None:
        row.tono = payload.tono  # Literal del schema: 422 con otro valor
    if payload.instrucciones_extra is not None:
        row.instrucciones_extra = payload.instrucciones_extra.strip()
    if payload.pausado is not None:
        row.pausado = payload.pausado
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _config_public(payload.tenant, row)


@router.patch("")
def patch_config(payload: BotConfigPatchIn,
                 user: User = Depends(require_perm("manage_settings")),
                 session: Session = Depends(get_session)):
    """DECISIÓN (contrato B: "PATCH {pausado} además de PUT — o extender PUT,
    lo más simple"): switch dedicado del "Asistente pausado" — un solo campo,
    un solo round-trip para la UI, mismo permiso (manage_settings) y mismo
    upsert que el PUT. El PUT también acepta pausado, así el form completo
    del Asistente puede guardar todo de una. updated_at se toca igual."""
    check_tenant_owner(payload.tenant, user)
    row = session.get(BotConfig, payload.tenant)
    if row is None:  # pausar un local que nunca guardó su Asistente
        row = BotConfig(tenant_id=payload.tenant,
                        nombre_bot=DEFAULT_NOMBRES.get(payload.tenant, "FaroBot"),
                        saludo=data.TENANTS[payload.tenant]["saludo"])
    if payload.pausado is not None:
        row.pausado = payload.pausado
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _config_public(payload.tenant, row)
