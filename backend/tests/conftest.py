"""Aísla la BD y los uploads de los tests: archivos temporales por corrida.

Debe correr ANTES de importar app.main: el engine (AUTH_DB_PATH) y el dir de
QRs de Yape (UPLOADS_DIR) se crean al importar los módulos, así los tests no
tocan backend/app.db, backend/uploads/ ni compiten con el server vivo.
Helpers compartidos (client, auth) para los tests de modulos-mvp:
app/__init__.py carga backend/.env en este punto (python-dotenv, override=False).
"""
import os
import tempfile
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

os.environ["AUTH_DB_PATH"] = os.path.join(
    tempfile.mkdtemp(prefix="faro-test-auth-"), "app.db")
os.environ.setdefault("UPLOADS_DIR", os.path.join(
    tempfile.mkdtemp(prefix="faro-test-uploads-")))  # saas-cola-2: QR de tests

from app import horarios  # noqa: E402 — después de AUTH_DB_PATH, a propósito
from app.main import app  # noqa: E402

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


# DECISIÓN (contrato horarios-pausa-notif-perfil): el gate de cerrado de
# brain.reply haría que los ~159 tests de flujo de chat/pedido dependieran de
# la HORA REAL de Lima en que corre la suite — "confirmar" de madrugada
# contestaría "Estamos cerrados" y el pedido no se tomaría. Se fija la hora
# ABIERTA (lunes 15:00, dentro de la ventana 12:00-22:00 del seed) para toda
# la suite, monkeypatcheando el ÚNICO punto que lee el reloj del sistema
# (horarios.hora_lima — ver su docstring sobre inyectabilidad). Los tests del
# change re-fijan la hora con su propio monkeypatch (fixture de módulo).
HORA_ABIERTA = datetime(2026, 10, 12, 15, 0)  # lunes 15:00 hora Lima


@pytest.fixture(autouse=True)
def _hora_abierta(monkeypatch):
    monkeypatch.setattr(horarios, "hora_lima", lambda: HORA_ABIERTA)
