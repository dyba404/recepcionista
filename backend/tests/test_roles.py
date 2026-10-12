"""roles-equipo: RBAC del equipo, patrón Chatwoot (roles → capacidades).

La matriz por endpoint: cada endpoint rewireado exige su capacidad via
require_perm — staff 403 donde toca (carta, equipo, ledger, settings),
staff OK en pedidos; admin OK en lo operativo y 403 en el dinero (cuenta
Culqi, módulos). Además: invite con rol (solo owner crea admins), PATCH de
nombre/rol con TODAS las guardas (owners, último owner, self, admin-sobre-
admin) y DELETE con las guardas ampliadas.

Aislamiento (patrón test_saas2): BD única por corrida — se borran los
usuarios/ledger/canales creados, los locales seed vuelven a fábrica, el
demo y los QR subidos se resetean.
"""
import uuid
from pathlib import Path
from urllib.parse import quote

import pytest
from conftest import client, login, registrar_y_loguear
from sqlmodel import Session, select

from app import data, persist, store, whatsapp
from app.db import engine
from app.models import Payment, Tenant, User, WhatsAppChannel
from app.roles import CAPACIDADES, PERMISOS
from app.tenants import UPLOADS_DIR

JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"\x00" * 8 + b"\xff\xd9"  # magic jpg real

CAMPOS_TENANT = ("nombre", "rubro", "distrito", "delivery", "tiempo",
                 "yape_qr", "saludo")


def _email(prefix="user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.pe"


def invitar(headers, rol="staff", tenant="faro", nombre="Invitado") -> dict:
    """POST /api/staff con rol; devuelve la respuesta (forma + rol)."""
    email = _email("eq")
    r = client.post("/api/staff", headers=headers,
                   json={"tenant": tenant, "email": email,
                         "password": "secreto123", "nombre": nombre,
                         "rol": rol})
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"id", "email", "nombre", "rol"}
    return r.json()


def headers_de(d: dict, password="secreto123"):
    """Login del invitado → headers Bearer."""
    return login(d["email"], password)


def _crear_pedido(cliente="Roles", tenant="faro") -> dict:
    r = client.post("/api/orders", json={"tenant": tenant, "cliente": cliente,
                                         "items": [{"id": "f1", "cant": 1}],
                                         "direccion": "Av Test 1"})
    assert r.status_code == 200, r.text
    return r.json()


def _pedido_pagado(cliente="Roles") -> dict:
    """Pedido pagado por Yape exacto (listo para avanzar sin anti-fraude)."""
    o = _crear_pedido(cliente)
    r = client.post("/api/payments/yape",
                    json={"order_id": o["id"], "monto_foto": o["total"]})
    assert r.json()["ok"] is True
    return o


@pytest.fixture(autouse=True)
def _aislamiento():
    """Restaura el mundo tras cada test (patrón test_saas2): usuarios,
    ledger y canales nuevos fuera; locales seed a fábrica + espejo; demo y
    QR subidos reseteados."""
    with Session(engine) as s:
        users_antes = set(s.exec(select(User.id)).all())
        pays_antes = set(s.exec(select(Payment.id)).all())
        canales_antes = set(s.exec(select(WhatsAppChannel.id)).all())
        tenants_antes = {r.id: tuple(getattr(r, c) for c in CAMPOS_TENANT)
                        for r in s.exec(select(Tenant)).all()}
    qrs_antes = {p.name for p in Path(UPLOADS_DIR).glob("*_yape_qr.png")}
    store.reset_demo()
    yield
    with Session(engine) as s:
        for p in s.exec(select(Payment)).all():
            if p.id not in pays_antes:
                s.delete(p)
        for ch in s.exec(select(WhatsAppChannel)).all():
            if ch.id not in canales_antes:
                s.delete(ch)
        for u in s.exec(select(User)).all():
            if u.id not in users_antes:
                s.delete(u)
        for tid, valores in tenants_antes.items():
            row = s.get(Tenant, tid)
            if row is not None and tuple(getattr(row, c) for c in CAMPOS_TENANT) != valores:
                for c, v in zip(CAMPOS_TENANT, valores):
                    setattr(row, c, v)
                s.add(row)
        s.commit()
        rows = s.exec(select(Tenant).order_by(Tenant.id)).all()
    data.TENANTS.clear()
    data.TENANTS.update({r.id: persist.tenant_dict(r) for r in rows})
    store.reset_demo()  # pedidos + carta a seed (los m1, m2… se van)
    for p in Path(UPLOADS_DIR).glob("*_yape_qr.png"):
        if p.name not in qrs_antes:
            p.unlink()


# ── la matriz misma (roles.py) ──

def test_permisos_matriz_del_contrato():
    assert set(CAPACIDADES) == {"manage_team", "manage_menu", "manage_settings",
                                "manage_orders", "answer_inbox", "view_ledger"}
    assert PERMISOS["owner"] == set(CAPACIDADES)  # owner: TODO
    assert PERMISOS["admin"] == set(CAPACIDADES)  # todo lo operativo…
    assert PERMISOS["staff"] == {"manage_orders", "answer_inbox"}
    # …pero el dinero NO es capacidad: Culqi/módulos quedan require_owner
    # (se prueba por endpoint abajo, no con una capacidad "manage_dinero")


# ── carta: manage_menu (owner+admin; staff 403) ──

def test_menu_matriz(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    base = {"tenant": "faro", "nombre": "Causa", "desc": "D", "precio": 18,
            "cat": "C", "disponible": True, "tags": "t"}
    # staff: 403 con el detalle exacto de require_perm
    r = client.post("/api/menu/toggle", headers=staff_headers,
                    json={"tenant": "faro", "id": "f1", "precio": 30})
    assert r.status_code == 403 and r.json()["detail"] == "Tu rol no permite manage_menu"
    assert client.post("/api/menu/items", headers=staff_headers,
                      json=base).status_code == 403
    assert client.delete("/api/menu/items?tenant=faro&id=f1",
                         headers=staff_headers).status_code == 403
    # sin token: 401
    assert client.post("/api/menu/toggle",
                       json={"tenant": "faro", "id": "f1"}).status_code == 401
    # admin: toggle y CRUD de items OK
    r = client.post("/api/menu/toggle", headers=admin_h,
                    json={"tenant": "faro", "id": "f1", "precio": 30})
    assert r.status_code == 200 and r.json()["precio"] == 30
    it = client.post("/api/menu/items", headers=admin_h, json=base).json()
    assert client.delete(f"/api/menu/items?tenant=faro&id={it['id']}",
                         headers=admin_h).json() == {"ok": True}


# ── pedidos: manage_orders (staff SÍ puede avanzar) ──

def test_orders_matriz():
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    staff = invitar(owner)  # default staff
    # staff avanza pedidos: la capacidad que sí tiene
    o = _pedido_pagado(cliente="Staff Avanza")
    r = client.patch(f"/api/orders/{quote(o['id'])}",
                     headers=headers_de(staff), json={"estado": "cocina"})
    assert r.status_code == 200 and r.json()["estado"] == "cocina"
    # admin también
    o2 = _pedido_pagado(cliente="Admin Avanza")
    r = client.patch(f"/api/orders/{quote(o2['id'])}",
                     headers=headers_de(admin), json={"estado": "cocina"})
    assert r.status_code == 200 and r.json()["estado"] == "cocina"
    # sin token sigue 401
    assert client.patch(f"/api/orders/{quote(o2['id'])}",
                        json={"estado": "cocina"}).status_code == 401


# ── ledger: view_ledger (owner+admin; staff 403) ──

def test_ledger_matriz(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    o = _pedido_pagado(cliente="Ledger Roles")
    # staff: 403 exacto
    r = client.get("/api/payments/ledger?tenant=faro", headers=staff_headers)
    assert r.status_code == 403 and r.json()["detail"] == "Tu rol no permite view_ledger"
    # admin de faro: 200 y ve el pago del pedido que acaba de entrar
    led = client.get("/api/payments/ledger?tenant=faro",
                     headers=headers_de(admin)).json()
    assert any(p["order_id"] == o["id"] and p["gateway"] == "yape" for p in led)
    # admin de OTRO tenant: pasa la capacidad pero el local no es suyo → 403
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    admin_brasa = invitar(brasa, rol="admin", tenant="brasa")
    assert client.get("/api/payments/ledger?tenant=faro",
                      headers=headers_de(admin_brasa)).status_code == 403


# ── settings: manage_settings (whatsapp setup/conectar/register-webhook +
#    tenants PATCH/QR; staff 403) ──

def test_whatsapp_settings_matriz(staff_headers, monkeypatch):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    # staff: 403 manage_settings en los tres endpoints de configuración
    for url, payload in (
            ("/api/whatsapp/setup", {"tenant": "faro", "phone_number_id": "X",
                                     "token": "Y"}),
            ("/api/whatsapp/register-webhook", {"tenant": "faro",
                                                 "callback_url": "https://x"}),
            ("/api/whatsapp/conectar", {"tenant": "faro"})):
        r = client.post(url, headers=staff_headers, json=payload)
        assert r.status_code == 403
        assert r.json()["detail"] == "Tu rol no permite manage_settings"
    # admin: setup guarda el canal (sin llamada HTTP)
    r = client.post("/api/whatsapp/setup", headers=admin_h,
                    json={"tenant": "faro", "phone_number_id": "PNID-ROLES",
                          "token": "TOK-ROLES"})
    assert r.status_code == 200 and r.json()["estado"] == "conectado"
    # register-webhook: admin pasa el permiso y llama Graph (mockeada)
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path)
        return {"success": True}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/register-webhook", headers=admin_h,
                   json={"tenant": "faro", "callback_url": "https://t.example/wh"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert captura["path"].endswith("/subscriptions")
    # conectar: admin OK con la secuencia mockeada (todos los pasos benignos)

    def fake_subs(path, data=None, method="POST", token="", timeout=30):
        if method == "GET":
            return {"data": [{"object": "whatsapp_business_account", "active": True,
                              "callback_url": "https://t.example/wh",
                              "fields": [{"name": "messages"}]}]}
        return {"success": True}

    monkeypatch.setattr(whatsapp, "graph_request", fake_subs)
    r = client.post("/api/whatsapp/conectar", headers=admin_h,
                    json={"tenant": "faro",
                          "callback_url": "https://t.example/wh"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_tenants_settings_matriz(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    # PATCH del local: admin OK, staff 403 manage_settings
    r = client.patch("/api/tenants/faro", headers=admin_h,
                     json={"delivery": 6.75})
    assert r.status_code == 200 and r.json()["delivery"] == 6.75
    r = client.patch("/api/tenants/faro", headers=staff_headers,
                     json={"delivery": 1})
    assert r.status_code == 403 and r.json()["detail"] == "Tu rol no permite manage_settings"
    # QR de Yape: admin puede subirlo, staff no
    r = client.post("/api/tenants/faro/qr", headers=admin_h,
                    files={"file": ("qr.jpg", JPEG_MAGIC, "image/jpeg")})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.post("/api/tenants/faro/qr", headers=staff_headers,
                       files={"file": ("qr.jpg", JPEG_MAGIC,
                                       "image/jpeg")}).status_code == 403
    # el alta de local NO cambió: sigue siendo del owner (require_owner)
    assert client.post("/api/tenants", headers=admin_h,
                       json={"nombre": "Local Admin", "distrito": "Surco"}
                       ).status_code == 403


# ── el dinero queda del owner: cuenta Culqi y módulos ──

def test_dinero_y_modulos_solo_owner():
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    cuenta = {"tenant": "faro", "public_key": "pk_test_123",
              "secret_key": "sk_test_456"}
    # cuenta Culqi POST/DELETE: admin 403 (require_owner, como siempre)
    r = client.post("/api/payments/cuenta", headers=admin_h, json=cuenta)
    assert r.status_code == 403 and r.json()["detail"] == "Solo el dueño puede configurar esto"
    assert client.delete("/api/payments/cuenta?tenant=faro",
                         headers=admin_h).status_code == 403
    # módulos PATCH: admin 403; owner SÍ (el gate de módulos no cambia)
    r = client.patch("/api/modules/pagos", headers=admin_h,
                     json={"tenant": "faro", "enabled": False})
    assert r.status_code == 403 and r.json()["detail"] == "Solo el dueño puede configurar esto"
    assert client.patch("/api/modules/pagos", headers=owner,
                        json={"tenant": "faro", "enabled": False}
                        ).status_code == 200


# ── equipo: manage_team + reglas de rol ──

def test_staff_crud_matriz(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    # staff: 403 manage_team en TODO el CRUD
    r = client.get("/api/staff?tenant=faro", headers=staff_headers)
    assert r.status_code == 403 and r.json()["detail"] == "Tu rol no permite manage_team"
    assert client.post("/api/staff", headers=staff_headers,
                       json={"tenant": "faro", "email": _email(),
                             "password": "secreto123", "nombre": "X"}
                       ).status_code == 403
    assert client.patch("/api/staff/1?tenant=faro", headers=staff_headers,
                        json={"nombre": "X"}).status_code == 403
    assert client.delete("/api/staff/1?tenant=faro", headers=staff_headers
                         ).status_code == 403
    # admin: lista el equipo (con el owner visible, sin editarlo)
    team = client.get("/api/staff?tenant=faro", headers=admin_h).json()
    roles = {u["rol"] for u in team}
    assert roles >= {"owner", "admin", "staff"}  # owner seed + admin + staff
    # admin invita staff (default y explícito) — PERO jamás admin (regla abajo)
    s1 = invitar(admin_h, nombre="Por Admin")
    assert s1["rol"] == "staff"
    s2 = invitar(admin_h, rol="staff", nombre="Staff Explicito")
    assert s2["rol"] == "staff"
    # rol inválido → 422; invitar "owner" tampoco existe ( Literal)
    assert client.post("/api/staff", headers=owner,
                       json={"tenant": "faro", "email": _email(),
                             "password": "secreto123", "nombre": "X",
                             "rol": "jefe"}).status_code == 422
    assert client.post("/api/staff", headers=owner,
                       json={"tenant": "faro", "email": _email(),
                             "password": "secreto123", "nombre": "X",
                             "rol": "owner"}).status_code == 422


def test_invite_admin_solo_lo_hace_el_owner():
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")  # el owner SÍ puede invitar admins
    assert admin["rol"] == "admin"
    assert client.get("/api/auth/me", headers=headers_de(admin)
                      ).json()["rol"] == "admin"
    # el admin invita staff OK, pero invitar admin → 403 con detalle
    assert client.post("/api/staff", headers=headers_de(admin),
                       json={"tenant": "faro", "email": _email(),
                             "password": "secreto123", "nombre": "Staff Ok",
                             "rol": "staff"}).status_code == 201
    r = client.post("/api/staff", headers=headers_de(admin),
                    json={"tenant": "faro", "email": _email(),
                          "password": "secreto123", "nombre": "Admin Mal",
                          "rol": "admin"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Solo el dueño puede invitar administradores"


def test_patch_staff_cambio_de_rol_y_nombre():
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    staff = invitar(owner)
    # owner cambia nombre y rol staff→admin en línea
    r = client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=owner,
                     json={"nombre": "Ahora Admin", "rol": "admin"})
    assert r.status_code == 200
    assert r.json()["nombre"] == "Ahora Admin" and r.json()["rol"] == "admin"
    # owner también puede volverlo a staff (el owner SÍ toca admins)
    r = client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=owner,
                     json={"rol": "staff"})
    assert r.status_code == 200 and r.json()["rol"] == "staff"
    # admin edita a un staff (nombre y rol admin→staff no aplica aquí)
    r = client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=admin_h,
                     json={"nombre": "Editado Por Admin"})
    assert r.status_code == 200 and r.json()["nombre"] == "Editado Por Admin"
    # PATCH vacío → 400; rol inválido → 422
    assert client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=owner,
                        json={}).status_code == 400
    assert client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=owner,
                        json={"rol": "jefe"}).status_code == 422
    assert client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=owner,
                        json={"rol": "owner"}).status_code == 422


def test_patch_staff_guardas_del_contrato(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    otro_admin = invitar(owner, rol="admin", nombre="Otro Admin")
    team = client.get("/api/staff?tenant=faro", headers=owner).json()
    seed_owner = next(u for u in team if u["email"] == "admin@demo.pe")
    # owners intocables por aquí: nombre → se edita en su perfil;
    # quitarle el rol → dejaría el local sin dueño (último owner)
    r = client.patch(f"/api/staff/{seed_owner['id']}?tenant=faro", headers=owner,
                     json={"nombre": "X"})
    assert r.status_code == 400 and "perfil" in r.json()["detail"]
    r = client.patch(f"/api/staff/{seed_owner['id']}?tenant=faro", headers=owner,
                     json={"rol": "staff"})
    assert r.status_code == 400 and "único dueño" in r.json()["detail"]
    # self: nadie se edita a sí mismo desde el equipo
    r = client.patch(f"/api/staff/{admin['id']}?tenant=faro", headers=admin_h,
                     json={"nombre": "Yo Mismo"})
    assert r.status_code == 400 and "a ti mismo" in r.json()["detail"]
    # admin-sobre-admin: ni editarlo ni promocionar a un staff a admin
    r = client.patch(f"/api/staff/{otro_admin['id']}?tenant=faro",
                     headers=admin_h, json={"nombre": "X"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Solo el dueño puede administrar a otros administradores"
    staff = invitar(owner)
    r = client.patch(f"/api/staff/{staff['id']}?tenant=faro", headers=admin_h,
                     json={"rol": "admin"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Solo el dueño puede administrar a otros administradores"
    # cruzado: miembro de otro equipo → 404; admin de otro tenant → 403
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.patch(f"/api/staff/{staff['id']}?tenant=brasa",
                        headers=brasa, json={"nombre": "X"}).status_code == 404
    admin_brasa = invitar(brasa, rol="admin", tenant="brasa")
    assert client.patch(f"/api/staff/{staff['id']}?tenant=faro",
                        headers=headers_de(admin_brasa),
                        json={"nombre": "X"}).status_code == 403
    # y staff sin manage_team: 403
    assert client.patch(f"/api/staff/{staff['id']}?tenant=faro",
                        headers=staff_headers,
                        json={"nombre": "X"}).status_code == 403


def test_delete_staff_guardas_ampliadas(staff_headers):
    owner, _ = registrar_y_loguear()
    admin = invitar(owner, rol="admin")
    admin_h = headers_de(admin)
    otro_admin = invitar(owner, rol="admin", nombre="Admin Baja")
    staff = invitar(owner)
    # admin elimina staff: OK
    assert client.delete(f"/api/staff/{staff['id']}?tenant=faro",
                         headers=admin_h).json() == {"ok": True}
    # admin NO elimina admins → 403 con detalle
    r = client.delete(f"/api/staff/{otro_admin['id']}?tenant=faro",
                      headers=admin_h)
    assert r.status_code == 403
    assert r.json()["detail"] == "Solo el dueño puede eliminar administradores"
    # owner tampoco elimina admins (guarda actual: solo personal staff)
    r = client.delete(f"/api/staff/{otro_admin['id']}?tenant=faro", headers=owner)
    assert r.status_code == 400 and "rol staff" in r.json()["detail"]
    # dueño de otro local: miembro ajeno → 404 (no filtra existencia)
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    staff2 = invitar(owner)
    assert client.delete(f"/api/staff/{staff2['id']}?tenant=brasa",
                         headers=brasa).status_code == 404
    # staff sin manage_team → 403
    assert client.delete(f"/api/staff/{staff2['id']}?tenant=faro",
                         headers=staff_headers).status_code == 403
