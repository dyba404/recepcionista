"""Aísla la BD de usuarios de los tests: archivo temporal por corrida.

Debe correr ANTES de importar app.main: el engine se crea al importar el módulo
leyendo AUTH_DB_PATH, así los tests no tocan backend/app.db ni compiten con el
server vivo. Helpers compartidos (client, auth) para los tests de modulos-mvp:
app/__init__.py carga backend/.env en este punto (python-dotenv, override=False).
"""
import os
import tempfile
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ["AUTH_DB_PATH"] = os.path.join(
    tempfile.mkdtemp(prefix="faro-test-auth-"), "app.db")

from app.main import app  # noqa: E402 — después de AUTH_DB_PATH, a propósito

client = TestClient(app)


def registrar_y_loguear(nombre="Owner Test", tenant_id="faro"):
    """Registra un usuario único, loguea y devuelve (headers, token)."""
    email = f"owner-{uuid.uuid4().hex[:8]}@test.pe"
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "secreto123",
                          "nombre": nombre, "tenant_id": tenant_id})
    assert r.status_code == 201
    r = client.post("/api/auth/login", json={"email": email, "password": "secreto123"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, token


def login(email: str, password: str):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture()
def owner_headers():
    return registrar_y_loguear()[0]


@pytest.fixture()
def staff_headers():
    return login("cocina@demo.pe", "demo1234")


@pytest.fixture(autouse=True)
def _modules_on():
    """Restaura TODOS los módulos ON tras cada test: los tests de gating los
    apagan y ningún test debe heredar ese estado."""
    yield
    from sqlmodel import Session, select

    from app import data, modules
    from app.db import engine
    from app.models import ModuleConfig
    with Session(engine) as session:
        for tenant in data.TENANTS:
            for key in modules.MODULES:
                cfg = session.exec(select(ModuleConfig).where(
                    ModuleConfig.tenant_id == tenant,
                    ModuleConfig.module_key == key)).first()
                if cfg is None:
                    session.add(ModuleConfig(tenant_id=tenant, module_key=key,
                                            enabled=True))
                else:
                    cfg.enabled = True
        session.commit()
