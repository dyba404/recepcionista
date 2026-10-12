"""saas-cola-2: SaaS de verdad — onboarding con negocio, equipo (staff),
locales en SQLite (POST/PATCH + slug), carta CRUD persistida, ledger de
pagos y QR de Yape real.

La BD de tests es UN solo archivo compartido por toda la corrida (patrón de
test_payments): el fixture autouse _aislamiento restaura el mundo tras cada
test — borra usuarios/locales creados, devuelve los seed a fábrica, resetea
el demo y limpia los QR subidos (UPLOADS_DIR temporal de conftest).
"""
import struct
import uuid
import zlib
from pathlib import Path

import pytest
from conftest import client, login, registrar_y_loguear
from sqlmodel import Session, select

from app import data, payments, persist, store
from app.db import engine
from app.models import MenuItem, Payment, Tenant, User
from app.tenants import UPLOADS_DIR

# ── helpers ──

def _png_1x1() -> bytes:
    """PNG real de 1x1 px (signature + IHDR + IDAT + IEND, CRCs correctos)."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(t: bytes, d: bytes) -> bytes:
        return (struct.pack(">I", len(d)) + t + d
                + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return (sig + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
            + chunk(b"IEND", b""))


PNG_1X1 = _png_1x1()
JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"\x00" * 8 + b"\xff\xd9"  # magic jpg real


def _email(prefix="user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.pe"


def _crear_pedido(cliente="Saas2", tenant="faro",
                  items=None, direccion="Av Prueba 200") -> dict:
    r = client.post("/api/orders", json={"tenant": tenant, "cliente": cliente,
                                         "items": items or [{"id": "f1", "cant": 1}],
                                         "direccion": direccion})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _aislamiento():
    """Restaura el mundo tras cada test: los locales seed vuelven a su
    fábrica (PATCH), los creados se borran (fila + espejo), los usuarios
    nuevos también, el demo se resetea y los QR subidos se limpian.

    El ledger se limpia a ambos lados: los tests previos (test_api,
    test_payments) ya escriben filas payment con ids #101… y reset_demo
    reinicia el contador — sin la limpieza, los pedidos nuevos repetirían
    order_id con filas viejas de otros tests."""
    with Session(engine) as s:
        for p in s.exec(select(Payment)).all():
            s.delete(p)
        s.commit()
        campos = ("nombre", "rubro", "distrito", "delivery", "tiempo",
                  "yape_qr", "saludo")
        tenants_antes = {r.id: tuple(getattr(r, c) for c in campos)
                        for r in s.exec(select(Tenant)).all()}
        users_antes = set(s.exec(select(User.id)).all())
    store.reset_demo()
    yield
    with Session(engine) as s:
        for p in s.exec(select(Payment)).all():
            s.delete(p)
        for r in s.exec(select(Tenant)).all():
            if r.id not in tenants_antes:
                s.delete(r)
        for u in s.exec(select(User)).all():
            if u.id not in users_antes:
                s.delete(u)
        for tid, valores in tenants_antes.items():
            row = s.get(Tenant, tid)
            if row is not None and tuple(getattr(row, c) for c in
                                         ("nombre", "rubro", "distrito",
                                          "delivery", "tiempo", "yape_qr",
                                          "saludo")) != valores:
                for c, v in zip(("nombre", "rubro", "distrito", "delivery",
                                 "tiempo", "yape_qr", "saludo"), valores):
                    setattr(row, c, v)
                s.add(row)
        s.commit()
        rows = s.exec(select(Tenant).order_by(Tenant.id)).all()
    # espejo tenants = la BD (mismo dict in place: seed a fábrica, nuevos fuera)
    data.TENANTS.clear()
    data.TENANTS.update({r.id: persist.tenant_dict(r) for r in rows})
    store.reset_demo()  # pedidos + carta a seed (los m1, m2… se van)
    for p in Path(UPLOADS_DIR).glob("*_yape_qr.png"):
        p.unlink()


# ── registro con negocio: local + owner atómicos ──

def test_registro_con_negocio_crea_tenant_owner_y_login():
    email = _email("negocio")
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "secreto123",
                          "nombre": "Dueño Nuevo",
                          "negocio": {"nombre": "Cevichería La Playa",
                                      "distrito": "Chorrillos", "delivery": 7.0}})
    assert r.status_code == 201
    d = r.json()
    slug = d["tenant_id"]
    assert slug == "cevicheria-la-playa"  # slug: minúsculas sin acentos
    assert d["rol"] == "owner"
    # el local aparece en el listado (de la BD) con forma de siempre
    tenants = {t["id"]: t for t in client.get("/api/tenants").json()}
    t = tenants[slug]
    assert t["nombre"] == "Cevichería La Playa" and t["distrito"] == "Chorrillos"
    assert t["delivery"] == 7.0 and t["saludo"] and t["rubro"] == "comidas"
    assert set(t) == {"id", "nombre", "rubro", "distrito", "delivery",
                      "tiempo", "yape_qr", "culqi_comision", "saludo"}
    # login funciona y el usuario es owner DEL nuevo local
    lr = client.post("/api/auth/login", json={"email": email,
                                              "password": "secreto123"})
    assert lr.status_code == 200
    assert lr.json()["user"]["tenant_id"] == slug
    assert lr.json()["user"]["rol"] == "owner"
    # el local nace operativo: carta vacía (no 404, no KeyError en calc_total)
    assert client.get(f"/api/menu?tenant={slug}").json()["items"] == []
    o = client.post("/api/orders", json={"tenant": slug, "cliente": "X",
                                        "items": [], "direccion": "Y"}).json()
    assert o["total"] == 7.0  # delivery del local nuevo
    # persistido en SQLite
    with Session(engine) as s:
        assert s.get(Tenant, slug) is not None


def test_registro_con_negocio_es_atomico_en_el_409():
    """Email ya registrado → 409 y NO queda ni user ni tenant (un commit)."""
    email = _email("dup-negocio")
    payload = {"email": email, "password": "secreto123", "nombre": "Dup",
               "negocio": {"nombre": "Local Que No Debe Existir",
                           "distrito": "Surco"}}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    with Session(engine) as s:
        n_antes = len(s.exec(select(Tenant)).all())
        assert s.exec(select(User).where(User.email == email)).first()
    assert client.post("/api/auth/register", json=payload).status_code == 409
    with Session(engine) as s:
        assert len(s.exec(select(Tenant)).all()) == n_antes
        # un solo user con ese email
        assert len(s.exec(select(User).where(User.email == email)).all()) == 1


# ── POST /api/tenants + PATCH: el dueño de SU local ──

def test_post_tenants_crea_su_local_y_lo_deja_configurable():
    headers, _ = registrar_y_loguear()  # owner autenticado
    r = client.post("/api/tenants", headers=headers,
                    json={"nombre": "Pollería Test", "distrito": "Los Olivos",
                          "delivery": 8.0, "tiempo": "40-50 min",
                          "yape_qr": "YA-TEST"})
    assert r.status_code == 200
    d = r.json()
    assert d["id"] == "polleria-test" and d["saludo"]
    assert d["distrito"] == "Los Olivos" and d["yape_qr"] == "YA-TEST"
    # el listado lo trae y quedó en SQLite
    assert d["id"] in {t["id"] for t in client.get("/api/tenants").json()}
    with Session(engine) as s:
        assert s.get(Tenant, "polleria-test") is not None
    # el creador quedó como dueño de SU local: PATCH pasa
    r = client.patch("/api/tenants/polleria-test", headers=headers,
                     json={"delivery": 9.5})
    assert r.status_code == 200 and r.json()["delivery"] == 9.5
    assert data.TENANTS["polleria-test"]["delivery"] == 9.5  # espejo actualizado
    with Session(engine) as s:
        assert s.get(Tenant, "polleria-test").delivery == 9.5


def test_post_tenants_slug_normaliza_y_colisiona_con_sufijo():
    headers, _ = registrar_y_loguear()
    r = client.post("/api/tenants", headers=headers,
                    json={"nombre": "Cevichería El Faro", "distrito": "Surco"})
    assert r.json()["id"] == "cevicheria-el-faro"  # sin acentos, sin espacios
    # "Faro" → slug "faro" ya existe → sufijo -2, luego -3
    r = client.post("/api/tenants", headers=headers,
                    json={"nombre": "Faro", "distrito": "Surco"})
    assert r.json()["id"] == "faro-2"
    r = client.post("/api/tenants", headers=headers,
                    json={"nombre": "Faro", "distrito": "Surco"})
    assert r.json()["id"] == "faro-3"


def test_post_tenants_authz(staff_headers):
    assert client.post("/api/tenants",
                       json={"nombre": "X", "distrito": "Y"}).status_code == 401
    assert client.post("/api/tenants", headers=staff_headers,
                       json={"nombre": "X", "distrito": "Y"}).status_code == 403


def test_patch_tenants_solo_el_dueno_del_local(staff_headers):
    headers, _ = registrar_y_loguear()  # owner de faro
    r = client.patch("/api/tenants/faro", headers=headers,
                     json={"delivery": 6.5, "yape_qr": "YA-NUEVO",
                           "nombre": "Cevichería El Faro Sur", "tiempo": "35-45 min"})
    assert r.status_code == 200
    d = r.json()
    assert d["delivery"] == 6.5 and d["yape_qr"] == "YA-NUEVO"
    assert d["nombre"] == "Cevichería El Faro Sur" and d["tiempo"] == "35-45 min"
    # brain/logic leen data.TENANTS: el espejo quedó actualizado
    t = data.TENANTS["faro"]
    assert t["delivery"] == 6.5 and t["yape_qr"] == "YA-NUEVO"
    with Session(engine) as s:
        assert s.get(Tenant, "faro").delivery == 6.5
    # el id/slug JAMÁS cambia (los pedidos lo referencian)
    assert t["id"] == "faro"
    # 403 cruzado: dueño de otro local; staff tampoco; sin token 401; 404 raro
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.patch("/api/tenants/faro", headers=brasa,
                        json={"delivery": 1}).status_code == 403
    assert client.patch("/api/tenants/faro", headers=staff_headers,
                        json={"delivery": 1}).status_code == 403
    assert client.patch("/api/tenants/faro",
                        json={"delivery": 1}).status_code == 401
    assert client.patch("/api/tenants/inventado", headers=headers,
                        json={"delivery": 1}).status_code == 404


# ── staff: equipo del local ──

def test_staff_crud_completo():
    headers, _ = registrar_y_loguear()  # owner de faro
    email = _email("staff")
    r = client.post("/api/staff", headers=headers,
                    json={"tenant": "faro", "email": email,
                          "password": "secreto123", "nombre": "Cocina Nueva"})
    assert r.status_code == 201
    d = r.json()
    sid = d["id"]
    assert d["rol"] == "staff" and d["email"] == email
    # el equipo completo: owner seed + staff seed + el nuevo (forma exacta)
    team = client.get("/api/staff?tenant=faro", headers=headers).json()
    emails = {u["email"] for u in team}
    assert {"admin@demo.pe", "cocina@demo.pe", email} <= emails
    assert all(set(u) == {"id", "email", "nombre", "rol"} for u in team)
    # el nuevo staff entra con su cuenta
    assert login(email, "secreto123")
    me_id = client.get("/api/auth/me", headers=headers).json()["id"]
    # no a sí mismo / solo rol staff
    r = client.delete(f"/api/staff/{me_id}?tenant=faro", headers=headers)
    assert r.status_code == 400 and "a ti mismo" in r.json()["detail"]
    owner_seed = next(u["id"] for u in team if u["email"] == "admin@demo.pe")
    r = client.delete(f"/api/staff/{owner_seed}?tenant=faro", headers=headers)
    assert r.status_code == 400 and "rol staff" in r.json()["detail"]
    # baja correcta y no repite
    assert client.delete(f"/api/staff/{sid}?tenant=faro",
                         headers=headers).json() == {"ok": True}
    assert client.delete(f"/api/staff/{sid}?tenant=faro",
                         headers=headers).status_code == 404
    with Session(engine) as s:
        assert s.get(User, sid) is None
    assert email not in {u["email"] for u in
                        client.get("/api/staff?tenant=faro",
                                   headers=headers).json()}


def test_staff_errores_y_authz(staff_headers):
    headers, _ = registrar_y_loguear()  # owner de faro
    # email duplicado → 409 (global: ya registrado por /api/auth/register)
    dup = _email("dup-staff")
    assert client.post("/api/auth/register",
                       json={"email": dup, "password": "secreto123",
                             "nombre": "Ya Existente"}).status_code == 201
    r = client.post("/api/staff", headers=headers,
                    json={"tenant": "faro", "email": dup,
                          "password": "secreto123", "nombre": "X"})
    assert r.status_code == 409
    # password corta → 422 (mín 8, como register)
    assert client.post("/api/staff", headers=headers,
                       json={"tenant": "faro", "email": _email(),
                             "password": "corta12", "nombre": "X"}
                       ).status_code == 422
    # owner de OTRO local no invita en el mío (403 cruzado)
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.post("/api/staff", headers=brasa,
                       json={"tenant": "faro", "email": _email(),
                             "password": "secreto123", "nombre": "X"}
                       ).status_code == 403
    # GET: sin token 401; staff (rol) 403; dueño cruzado 403
    assert client.get("/api/staff?tenant=faro").status_code == 401
    assert client.get("/api/staff?tenant=faro",
                      headers=staff_headers).status_code == 403
    assert client.get("/api/staff?tenant=faro", headers=brasa).status_code == 403
    # DELETE de alguien de otro equipo → 404 (no filtra existencia)
    cocina = client.post("/api/staff", headers=headers,
                         json={"tenant": "faro", "email": _email(),
                               "password": "secreto123", "nombre": "Cocina"}).json()
    assert client.delete(f"/api/staff/{cocina['id']}?tenant=brasa",
                         headers=brasa).status_code == 404
    # 404 de local desconocido
    assert client.post("/api/staff", headers=headers,
                       json={"tenant": "inventado", "email": _email(),
                             "password": "secreto123", "nombre": "X"}
                       ).status_code == 404


# ── carta CRUD: alta con id m1, m2… + persistencia ──

def test_menu_items_crud_y_persistencia():
    headers, _ = registrar_y_loguear()
    r = client.post("/api/menu/items", headers=headers,
                    json={"tenant": "faro", "nombre": "Causa limeña",
                          "desc": "Papa, ají, palta", "precio": 18.5,
                          "cat": "Criollos", "disponible": True,
                          "tags": "causa papa"})
    assert r.status_code == 200
    it = r.json()
    assert it["id"] == "m1"  # primer id autogenerado
    assert it["foto"] == "/static/img/platos/m1.jpg"
    assert it["precio"] == 18.5 and it["disponible"] is True
    # fila en SQLite con la columna desc_ ← clave "desc"
    with Session(engine) as s:
        row = s.get(MenuItem, "m1")
        assert row.tenant_id == "faro" and row.nombre == "Causa limeña"
        assert row.precio == 18.5 and row.desc_ == "Papa, ají, palta"
        assert row.cat == "Criollos" and row.tags == "causa papa"
    # el espejo lo lista (lo que brain/find_item lee) y sigue la numeración
    menu = client.get("/api/menu?tenant=faro").json()["items"]
    assert any(x["id"] == "m1" for x in menu)
    r = client.post("/api/menu/items", headers=headers,
                    json={"tenant": "faro", "nombre": "Picarones",
                          "precio": 12, "cat": "Postres"})
    assert r.json()["id"] == "m2"
    # ids GLOBALES (pk de menu_item es el id solo): el primer plato de OTRO
    # local continúa la numeración, nunca colisiona (lo agrega SU dueño)
    brasa_headers, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    r = client.post("/api/menu/items", headers=brasa_headers,
                    json={"tenant": "brasa", "nombre": "Ensalada fresca",
                          "precio": 10, "cat": "Extras"})
    assert r.json()["id"] == "m3"
    # el plato nuevo responde en el chat (RAG sobre el espejo)
    d = client.post("/api/chat", json={"tenant": "faro", "customer": "Saas2",
                                      "message": "quiero causa", "cart": []}).json()
    assert d["cart"] and d["cart"][0]["id"] == "m1"
    # DELETE: fila + espejo fuera
    assert client.delete("/api/menu/items?tenant=faro&id=m1",
                         headers=headers).json() == {"ok": True}
    with Session(engine) as s:
        assert s.get(MenuItem, "m1") is None
    assert all(x["id"] != "m1" for x in
               client.get("/api/menu?tenant=faro").json()["items"])
    # borrar lo que no existe → 404
    assert client.delete("/api/menu/items?tenant=faro&id=m1",
                         headers=headers).status_code == 404


def test_menu_items_authz_y_validaciones(staff_headers):
    headers, _ = registrar_y_loguear()
    base = {"tenant": "faro", "nombre": "Plato", "desc": "D", "precio": 20,
            "cat": "C", "disponible": True, "tags": "t"}
    # sin token 401; staff 403; dueño de otro local 403
    assert client.post("/api/menu/items", json=base).status_code == 401
    assert client.post("/api/menu/items", headers=staff_headers,
                      json=base).status_code == 403
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.post("/api/menu/items", headers=brasa,
                       json=base).status_code == 403
    # precio fuera de rango (mismo criterio que el toggle)
    assert client.post("/api/menu/items", headers=headers,
                       json={**base, "precio": -5}).status_code == 400
    assert client.post("/api/menu/items", headers=headers,
                       json={**base, "precio": 10000}).status_code == 400
    # DELETE igual: staff 403, item de otro tenant 404
    it = client.post("/api/menu/items", headers=headers, json=base).json()
    assert client.delete(f"/api/menu/items?tenant=faro&id={it['id']}",
                         headers=staff_headers).status_code == 403
    assert client.delete(f"/api/menu/items?tenant=brasa&id={it['id']}",
                         headers=brasa).status_code == 404


# ── ledger: UNA fila por acción de pago ──

def test_ledger_culqi_simulado_y_yape():
    headers, _ = registrar_y_loguear()  # owner de faro lee SU ledger
    # culqi simulado: link + webhook
    o = _crear_pedido(cliente="Ledger Culqi")
    link = client.post("/api/payments/culqi/link",
                       json={"tenant": "faro", "order_id": o["id"]}).json()
    wh = client.post("/api/payments/culqi/webhook",
                     json={"reference_id": link["reference_id"]}).json()
    assert wh["ok"]
    # yape exacto
    o2 = _crear_pedido(cliente="Ledger Yape")
    assert client.post("/api/payments/yape",
                       json={"order_id": o2["id"],
                             "monto_foto": o2["total"]}).json()["ok"] is True
    # yape falso → pendiente_verificar
    o3 = _crear_pedido(cliente="Ledger Yape Falso")
    yf = client.post("/api/payments/yape", json={"order_id": o3["id"],
                                                 "monto_foto": 0.5}).json()
    assert yf["ok"] is False
    # el ledger del local los trae, el más reciente primero
    led = client.get("/api/payments/ledger?tenant=faro", headers=headers).json()
    por_orden = {p["order_id"]: p for p in led}
    assert led[0]["order_id"] == o3["id"]  # desc
    w = por_orden[o["id"]]
    assert w["gateway"] == "culqi_simulado" and w["estado"] == "verificado"
    assert w["monto"] == o["total"]
    assert w["referencia"] == link["reference_id"] and w["created_at"]
    assert w["comision"] == round(o["total"] * 0.0344, 2)
    y = por_orden[o2["id"]]
    assert y["gateway"] == "yape" and y["estado"] == "verificado"
    assert y["comision"] == 0.0  # Yape: transferencia directa, sin pasarela
    yf2 = por_orden[o3["id"]]
    assert yf2["gateway"] == "yape" and yf2["estado"] == "pendiente_verificar"
    assert "monto foto" in yf2["detalle"]
    # UNA fila por acción (ni el link, ni nada extra)
    with Session(engine) as s:
        for oid in (o["id"], o2["id"], o3["id"]):
            filas = s.exec(select(Payment).where(Payment.order_id == oid)).all()
            assert len(filas) == 1, oid


def test_ledger_charge_real_con_cargo_mockeado(monkeypatch):
    """Cargo REAL de Culqi con crear_cargo_culqi monkeypateado (patrón
    test_payments): verificado al exitir, rechazado al rechazar."""
    monkeypatch.setenv("CULQI_SECRET_KEY", "sk_test_FALLBACK")
    headers, _ = registrar_y_loguear()

    def cargo_ok(sk, monto, token, email="cliente@demo.pe", timeout=30):
        return {"id": "chr_ok", "outcome": {"type": "venta_exitosa",
                                            "user_message": "Venta exitosa."}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", cargo_ok)
    o = _crear_pedido(cliente="Charge Real")
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 200 and r.json()["ok"] is True
    led = {p["order_id"]: p for p in client.get(
        "/api/payments/ledger?tenant=faro", headers=headers).json()}
    p = led[o["id"]]
    assert p["gateway"] == "culqi_real" and p["estado"] == "verificado"
    assert p["referencia"] == "chr_ok" and p["monto"] == o["total"]
    assert p["comision"] == round(o["total"] * 0.0344, 2)

    def cargo_rechazado(sk, monto, token, email="cliente@demo.pe", timeout=30):
        return {"id": "chr_bad", "outcome": {"type": "card_error",
                                             "user_message": "Tarjeta rechazada"}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", cargo_rechazado)
    o2 = _crear_pedido(cliente="Charge Rechazado")
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o2["id"], "token": "tkn_test"})
    assert r.status_code == 200 and r.json()["ok"] is False
    led = {p["order_id"]: p for p in client.get(
        "/api/payments/ledger?tenant=faro", headers=headers).json()}
    p = led[o2["id"]]
    assert p["gateway"] == "culqi_real" and p["estado"] == "rechazado"
    assert p["detalle"] == "Tarjeta rechazada"


def test_ledger_authz():
    headers, _ = registrar_y_loguear()  # owner de faro
    _crear_pedido(cliente="Ledger Authz")
    assert client.get("/api/payments/ledger?tenant=faro").status_code == 401
    assert client.get("/api/payments/ledger?tenant=faro",
                      headers=login("cocina@demo.pe", "demo1234")).status_code == 403
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.get("/api/payments/ledger?tenant=faro",
                      headers=brasa).status_code == 403
    assert client.get("/api/payments/ledger?tenant=inventado",
                      headers=headers).status_code == 404
    # el owner de faro SÍ
    assert client.get("/api/payments/ledger?tenant=faro",
                      headers=headers).status_code == 200


# ── QR de Yape real: upload + GET público + config ──

def test_qr_yape_upload_get_y_config():
    headers, _ = registrar_y_loguear()  # owner de faro
    # antes: no hay QR y el config lo dice
    assert client.get("/api/tenants/faro/qr").status_code == 404
    cfg = client.get("/api/payments/config?tenant=faro").json()
    assert cfg["yape_qr_imagen"] is False and cfg["yape_qr"] == "YA-FARO-123"
    # upload multipart con un PNG real de 1x1
    r = client.post("/api/tenants/faro/qr", headers=headers,
                    files={"file": ("qr.png", PNG_1X1, "image/png")})
    assert r.status_code == 200 and r.json() == {"ok": True}
    # archivo en uploads/{tenant}_yape_qr.png, byte a byte
    p = Path(UPLOADS_DIR) / "faro_yape_qr.png"
    assert p.is_file() and p.read_bytes() == PNG_1X1
    # GET público (sin token) sirve la imagen
    g = client.get("/api/tenants/faro/qr")
    assert g.status_code == 200
    assert g.headers["content-type"].startswith("image/png")
    assert g.content == PNG_1X1
    # el config ahora anuncia la imagen (el front la muestra en el paybox)
    assert client.get("/api/payments/config?tenant=faro"
                      ).json()["yape_qr_imagen"] is True


def test_qr_yape_validaciones(staff_headers):
    headers, _ = registrar_y_loguear()  # owner de faro
    # extensión inválida (magic bueno): solo png/jpg
    r = client.post("/api/tenants/faro/qr", headers=headers,
                    files={"file": ("qr.txt", PNG_1X1, "application/octet-stream")})
    assert r.status_code == 400 and "png o jpg" in r.json()["detail"]
    # extensión buena pero magic bytes de otra cosa → 400
    r = client.post("/api/tenants/faro/qr", headers=headers,
                    files={"file": ("qr.png", b"no-es-una-imagen", "image/png")})
    assert r.status_code == 400 and "válida" in r.json()["detail"]
    # más de 2MB → 400 (aunque sea png de verdad)
    grande = PNG_1X1 + b"\x00" * (2 * 1024 * 1024)
    r = client.post("/api/tenants/faro/qr", headers=headers,
                    files={"file": ("qr.png", grande, "image/png")})
    assert r.status_code == 400 and "2MB" in r.json()["detail"]
    # jpg válido también pasa (magic jpeg)
    r = client.post("/api/tenants/faro/qr", headers=headers,
                    files={"file": ("qr.jpg", JPEG_MAGIC, "image/jpeg")})
    assert r.status_code == 200
    # authz: sin token 401, staff 403, dueño cruzado 403, local raro 404
    assert client.post("/api/tenants/faro/qr",
                       files={"file": ("qr.png", PNG_1X1, "image/png")}
                       ).status_code == 401
    assert client.post("/api/tenants/faro/qr", headers=staff_headers,
                       files={"file": ("qr.png", PNG_1X1, "image/png")}
                       ).status_code == 403
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.post("/api/tenants/faro/qr", headers=brasa,
                       files={"file": ("qr.png", PNG_1X1, "image/png")}
                       ).status_code == 403
    assert client.post("/api/tenants/inventado/qr", headers=headers,
                       files={"file": ("qr.png", PNG_1X1, "image/png")}
                       ).status_code == 404
    # GET de un local que no existe → 404
    assert client.get("/api/tenants/inventado/qr").status_code == 404
