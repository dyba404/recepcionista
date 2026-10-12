"""Seed idempotente de usuarios demo y módulos, llamado desde main al arrancar.

Crea las tablas y deja el login de sandbox: admin@demo.pe / demo1234 (owner)
y cocina@demo.pe / demo1234 (staff). Además siembra ModuleConfig con TODOS los
módulos activados para cada tenant (modulos-mvp). No toca MENUS/SEED_ORDERS:
la carta y los pedidos siguen en memoria.
"""
from sqlmodel import Session, select

from . import data, modules, security
from .db import engine, init_db
from .models import ModuleConfig, User

DEMO_USERS = [
    # (email, password, nombre, tenant, rol) — credenciales de sandbox
    ("admin@demo.pe", "demo1234", "Admin Faro", "faro", "owner"),
    ("cocina@demo.pe", "demo1234", "Cocina Faro", "faro", "staff"),
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
        session.commit()
