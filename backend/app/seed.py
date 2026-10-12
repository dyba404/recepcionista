"""Seed idempotente de usuarios demo y módulos, llamado desde main al arrancar.

Crea las tablas y deja el login de sandbox: admin@demo.pe / demo1234 (owner)
y cocina@demo.pe / demo1234 (staff). Además siembra ModuleConfig con TODOS los
módulos activados para cada tenant (modulos-mvp), la base de conocimiento
demo del faro (carta-inventario-bot), un BotConfig por tenant con los
nombres actuales y los horarios 12:00-22:00 de Lun a Dom (horarios-pausa-
notif-perfil). Todo POR FILA: re-hidratar jamás recrea lo que ya existe.
"""
from sqlmodel import Session, select

from . import bot, data, horarios, modules, security
from .db import engine, init_db
from .models import BotConfig, KnowledgeEntry, ModuleConfig, Tenant, User

DEMO_USERS = [
    # (email, password, nombre, tenant, rol) — credenciales de sandbox
    ("admin@demo.pe", "demo1234", "Admin Faro", "faro", "owner"),
    ("cocina@demo.pe", "demo1234", "Cocina Faro", "faro", "staff"),
]

# KB demo del faro (contrato carta-inventario-bot): horarios/ubicación/promos
# tal cual los quiere responder el NLU determinista (HORARIO_W/UBICACION_W).
KB_SEED = [
    ("Horarios", "Lun a Dom, 12:00 a 22:00"),
    ("Ubicación", "Av. El Faro 123, Surco — frente al mar"),
    ("Promociones", "Lleva 2 ceviches y la chicha va por la casa"),
]


def run() -> None:
    init_db()
    with Session(engine) as session:
        if session.exec(select(User)).first() is None:
            for email, password, nombre, tenant, rol in DEMO_USERS:
                session.add(User(email=email,
                                password_hash=security.hash_password(password),
                                nombre=nombre, tenant_id=tenant, rol=rol))
        # módulos: seed todo ON para cada tenant (idempotente)
        for tenant in data.TENANTS:
            for key in modules.MODULES:
                exists = session.exec(select(ModuleConfig).where(
                    ModuleConfig.tenant_id == tenant,
                    ModuleConfig.module_key == key)).first()
                if exists is None:
                    session.add(ModuleConfig(tenant_id=tenant, module_key=key,
                                             enabled=True))
        # KB del faro: solo las entradas que no existan (idempotente por
        # tenant+tema — el dueño puede editarlas y el re-arranque no las pisa)
        for tema, contenido in KB_SEED:
            exists = session.exec(select(KnowledgeEntry).where(
                KnowledgeEntry.tenant_id == "faro",
                KnowledgeEntry.tema == tema)).first()
            if exists is None:
                session.add(KnowledgeEntry(tenant_id="faro", tema=tema,
                                            contenido=contenido, activo=True))
        # Asistente: un BotConfig por tenant con el nombre actual
        # (FaroBot/BrasaBot/JuanaBot) y el saludo que ya usaba el local.
        for tid, t in data.TENANTS.items():
            if session.get(BotConfig, tid) is None:
                session.add(BotConfig(tenant_id=tid,
                                      nombre_bot=bot.DEFAULT_NOMBRES.get(
                                          tid, "FaroBot"),
                                      saludo=t["saludo"], tono="cercano",
                                      instrucciones_extra=""))
        # Horarios: 7 filas por local (Lun..Dom activo 12:00-22:00), el mismo
        # default con el que opera estado_local cuando faltan (horarios.py).
        for tid in data.TENANTS:
            horarios.seed_horarios(session, tid)
        # endurecer-local E: los 3 locales DEMO quedan en plan "basico" (sin
        # trial — el demo no expira). Solo toca el default que deja el ALTER
        # de la migración sobre una BD preexistente: un plan activado por el
        # owner (basico/pro) jamás se pisa, y el trial solo existe en el alta.
        for tid in ("faro", "brasa", "juana"):
            row = session.get(Tenant, tid)
            if row is not None and row.plan == "trial":
                row.plan = "basico"
                session.add(row)
        session.commit()
