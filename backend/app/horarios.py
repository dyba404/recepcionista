"""Horarios de atención por local (change horarios-pausa-notif-perfil, parte A).

Patrón Chatwoot working hours: UNA fila (tenant, dia) por día de la semana con
su ventana "HH:MM" en HORA LOCAL del local. estado_local(tenant) es el helper
que brain.reply usa para cerrar el pedido fuera de horario; GET /api/horarios
expone las 7 filas + abierto_ahora + mensaje_estado para la UI del dueño.

Zona horaria: America/Lima (zoneinfo de la stdlib) con cadena de fallback
documentada: (1) America/Lima; (2) UTC si la zona de Lima no está en el
tzdata del sistema (fallback del contrato); (3) offset FIJO UTC-5 si no hay
tz database alguna (Windows sin el paquete tzdata es el caso real: zoneinfo
falla hasta para "UTC"). Perú no tiene DST, así que el offset fijo es
exactamente America/Lima para siempre — los tres niveles leen la misma
hora de pared.

INYECTABILIDAD del reloj (decisión del contrato): hora_lima() es el ÚNICO punto
que lee el reloj real. Todo el resto (estado_local, abrimos_en, GET) pasa por
él, y estado_local/abrimos_en admiten además un `now=` con la hora ya fijada.
Los tests usan cualquiera de las dos vías: monkeypatch de hora_lima (fija la
hora para TODA la app, incluido brain.reply) o now= directo para el unit-test
de la ventana. Sin esto, la suite entera dependería de la hora de Lima al
correr ("confirmar" de madrugada no tomaría el pedido).

Caching: SIN cache a propósito (misma decisión que bot.py): 7 filas por local,
un SELECT por mensaje que abre el gate. El PATCH es visible en el mensaje
siguiente sin invalidación alguna.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from .db import engine, get_session
from .deps import check_tenant_owner, get_current_user
from .models import Horario, User
from .roles import require_perm
from .schemas import HorariosPatchIn

router = APIRouter(prefix="/api/horarios", tags=["horarios"])

# Cadena de fallback documentada arriba: Lima → UTC → offset fijo UTC-5
# (Lima no tiene DST; el offset fijo es indistinguible de America/Lima).
try:
    ZONA = ZoneInfo("America/Lima")
except Exception:
    try:
        ZONA = ZoneInfo("UTC")
    except Exception:  # sin tzdata alguno (Windows sin el paquete): UTC-5 fijo
        ZONA = timezone(timedelta(hours=-5))

# dia int 0=Lunes..6=Domingo (== datetime.weekday()); nombres en español para
# el mensaje de "próxima apertura" (contrato: "abre el lunes a las 12:00").
DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
DEFAULT_APERTURA = "12:00"
DEFAULT_CIERRE = "22:00"
SIN_DIAS = "Cerrado — sin días de atención configurados"


def hora_lima() -> datetime:
    """AHORA en hora local del local. Único punto de lectura del reloj: los
    tests lo monkeypatchean para fijar la hora de toda la app."""
    return datetime.now(ZONA)


def _ahora(now: datetime | None) -> datetime:
    """Normaliza el `now` inyectado a hora de pared local: aware → Lima,
    naive → se toma tal cual (es la hora local que el test quiso fijar)."""
    if now is None:
        return hora_lima()
    if now.tzinfo is not None:
        return now.astimezone(ZONA)
    return now


def _min(hhmm: str) -> int:
    """"HH:MM" → minutos desde medianoche (el schema ya validó el formato)."""
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _filas(tenant: str, session: Session | None = None) -> list[Horario]:
    """Las 7 filas del local ordenadas Lun..Dom. Sin filas (local recién nacido
    antes del seed o tabla ausente) cae al DEFAULT del seed — mismo fail-open
    que modules: la BD vacía nunca tumba el bot."""
    try:
        if session is None:
            with Session(engine) as own:
                return _filas(tenant, own)
        return session.exec(select(Horario).where(
            Horario.tenant_id == tenant).order_by(Horario.dia)).all()
    except Exception:
        return []


def _dias_efectivos(tenant: str) -> list[dict]:
    """7 slots 0..6 con la fila real o el default (activo 12:00-22:00) — lo
    que comparan estado_local/GET: un local sin filas se comporta como el seed."""
    rows = {r.dia: r for r in _filas(tenant)}
    out = []
    for dia in range(7):
        r = rows.get(dia)
        out.append({"dia": dia, "activo": r.activo if r else True,
                    "apertura": r.apertura if r else DEFAULT_APERTURA,
                    "cierre": r.cierre if r else DEFAULT_CIERRE})
    return out


def _calculo(tenant: str, now: datetime | None) -> dict:
    """Estado crudo del local: abierto + la próxima apertura (hoy más tarde o
    el próximo día activo con su nombre en español)."""
    t = _ahora(now)
    hoy = t.weekday()
    mins = t.hour * 60 + t.minute
    dias = _dias_efectivos(tenant)
    d = dias[hoy]
    if d["activo"] and _min(d["apertura"]) <= mins < _min(d["cierre"]):
        return {"abierto": True, "cierra": d["cierre"], "abre": None,
                "abre_dia": None, "sin_dias": False}
    if d["activo"] and mins < _min(d["apertura"]):
        # hoy abre más tarde: la próxima apertura es HOY
        return {"abierto": False, "cierra": None, "abre": d["apertura"],
                "abre_dia": None, "sin_dias": False}
    for k in range(1, 8):  # mañana (k=1) .. dentro de 7 días (k=7 == hoy)
        nd = (hoy + k) % 7
        if dias[nd]["activo"]:
            return {"abierto": False, "cierra": None,
                    "abre": dias[nd]["apertura"], "abre_dia": nd,
                    "sin_dias": False}
    return {"abierto": False, "cierra": None, "abre": None, "abre_dia": None,
            "sin_dias": True}  # ni hoy ni nunca: ningún día activo


def estado_local(tenant: str, now: datetime | None = None) -> tuple[bool, str]:
    """(abierto, mensaje_estado) del local — contrato A:
    "Abierto — cierra a las 22:00" / "Cerrado — abre a las 12:00" /
    "Cerrado — abre el lunes a las 12:00" según hora local Lima."""
    c = _calculo(tenant, now)
    if c["abierto"]:
        return True, f"Abierto — cierra a las {c['cierra']}"
    if c["sin_dias"]:
        return False, SIN_DIAS
    if c["abre_dia"] is None:
        return False, f"Cerrado — abre a las {c['abre']}"
    return False, f"Cerrado — abre el {DIAS[c['abre_dia']]} a las {c['abre']}"


def abrimos_en(tenant: str, now: datetime | None = None) -> str | None:
    """Frase de apertura para el saludo cerrado del bot ("Estamos cerrados —
    abrimos…"): "abrimos a las 12:00" / "abrimos el lunes a las 12:00".
    None si está abierto o no hay ningún día activo (solo "Estamos cerrados")."""
    c = _calculo(tenant, now)
    if c["abierto"] or c["sin_dias"]:
        return None
    if c["abre_dia"] is None:
        return f"abrimos a las {c['abre']}"
    return f"abrimos el {DIAS[c['abre_dia']]} a las {c['abre']}"


# ── seed idempotente (7 filas por local, patrón KB/BotConfig) ──

def seed_horarios(session: Session, tenant_id: str) -> None:
    """Siembra las 7 filas del local (activo 12:00-22:00) si faltan, SIN
    commit: la transacción la cierra el caller (seed.run al arrancar;
    crear_tenant para los locales que nacen después)."""
    for dia in range(7):
        exists = session.exec(select(Horario).where(
            Horario.tenant_id == tenant_id, Horario.dia == dia)).first()
        if exists is None:
            session.add(Horario(tenant_id=tenant_id, dia=dia, activo=True,
                                apertura=DEFAULT_APERTURA,
                                cierre=DEFAULT_CIERRE))


# ── router ──

def _respuesta(tenant: str, session: Session) -> dict:
    """Forma del GET/PATCH: 7 días Lun..Dom (filas reales o defaults si el
    local aún no tiene) + abierto_ahora + mensaje_estado según hora Lima."""
    filas = _filas(tenant, session)
    if filas:
        dias = [{"dia": r.dia, "activo": r.activo, "apertura": r.apertura,
                 "cierre": r.cierre} for r in filas]
    else:  # local sin filas: los defaults con los que el bot está operando
        dias = _dias_efectivos(tenant)
    abierto, mensaje = estado_local(tenant)
    return {"tenant": tenant, "dias": dias,
            "abierto_ahora": abierto, "mensaje_estado": mensaje}


@router.get("")
def get_horarios(tenant: str, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)  # Bearer + del propio local
    return _respuesta(tenant, session)


@router.patch("")
def patch_horarios(payload: HorariosPatchIn,
                   user: User = Depends(require_perm("manage_settings")),
                   session: Session = Depends(get_session)):
    """Upsert de los días que vienen en `dias` (el front manda los 7): la fila
    (tenant, dia) se crea o se actualiza; el resto queda como estaba. La
    validación de rango/HH:MM/apertura<cierre es del schema (422)."""
    check_tenant_owner(payload.tenant, user)
    for d in payload.dias:
        row = session.exec(select(Horario).where(
            Horario.tenant_id == payload.tenant,
            Horario.dia == d.dia)).first()
        if row is None:
            row = Horario(tenant_id=payload.tenant, dia=d.dia)
        row.activo = d.activo
        row.apertura = d.apertura
        row.cierre = d.cierre
        session.add(row)
    session.commit()
    return _respuesta(payload.tenant, session)
