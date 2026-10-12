"""endurecer-local: TODO el contrato del backend — A CSV, B cifrado,
C invitaciones, D plantillas, E planes.

La BD de tests es un solo archivo compartido (patrón test_saas2): el fixture
autouse _aislamiento borra invitaciones/plantillas/cuentas/canales/ledger
creados y los usuarios/locales nuevos, restaura el plan de los locales
seed y resetea el demo — ninguna otra suite hereda estado de esta.

DECISIÓN sobre el bullet "staff 403 en pedidos.csv" del contrato: la RUTA
dice "(Bearer, manage_orders)" y staff TIENE manage_orders (roles.py), así
que pedidos.csv responde 200 al staff del propio local; el 403 del staff
se cubre en ledger.csv (view_ledger, que staff NO tiene) y en el cruzado
(check_tenant_owner). Documentado como desviación del bullet de tests,
fiándonos de la definición de la ruta.
"""
import csv
import io
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from conftest import client, login, registrar_y_loguear
from sqlmodel import Session, select

from app import crypto, data, db, payments, persist, store, whatsapp
from app.db import engine
from app.models import (
    Invitation,
    Payment,
    PaymentAccount,
    Tenant,
    User,
    WATemplate,
    WhatsAppChannel,
)

FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")


def _email(prefix="user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.pe"


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sql_columnas(tabla: str, columna: str) -> list:
    """Lee la BD CRUDA (sql directo, sin pasar por los modelos): así se
    prueba que el plaintext NO está en el archivo (contrato B)."""
    with engine.connect() as conn:
        return conn.exec_driver_sql(f"SELECT {columna} FROM {tabla}").fetchall()


def _crear_pedido(cliente="Csv", tenant="faro", items=None,
                  direccion="Calle Csv 1") -> dict:
    r = client.post("/api/orders", json={"tenant": tenant, "cliente": cliente,
                                         "items": items or [{"id": "f1", "cant": 1}],
                                         "direccion": direccion})
    assert r.status_code == 200, r.text
    return r.json()


def _invitar(headers, email, rol="staff", tenant="faro") -> dict:
    r = client.post("/api/staff/invite", headers=headers,
                    json={"tenant": tenant, "email": email, "rol": rol})
    assert r.status_code == 201, r.text
    return r.json()


def _crear_admin(owner_headers) -> dict:
    """Alta de un admin del faro (solo el owner invita admins) + login."""
    email = _email("admin")
    r = client.post("/api/staff", headers=owner_headers,
                    json={"tenant": "faro", "email": email,
                          "password": "secreto123", "nombre": "Admin Local",
                          "rol": "admin"})
    assert r.status_code == 201, r.text
    return login(email, "secreto123")


@pytest.fixture(autouse=True)
def _aislamiento():
    """Arranca y termina limpio: sin invitaciones/plantillas/ledger (los
    tests previos, p.ej. test_api, dejan filas payment), y al final sin
    usuarios/locales/cuentas/canales nuevos, con el plan de los seed
    restaurado y el demo a fábrica (nada contamina otras suites)."""
    with Session(engine) as s:
        users_antes = set(s.exec(select(User.id)).all())
        tenants_antes = {r.id: (r.plan, r.trial_hasta)
                         for r in s.exec(select(Tenant)).all()}
        cuentas_antes = set(s.exec(select(PaymentAccount.id)).all())
        canales_antes = set(s.exec(select(WhatsAppChannel.id)).all())
        for row in s.exec(select(Invitation)).all():
            s.delete(row)
        for row in s.exec(select(WATemplate)).all():
            s.delete(row)
        for row in s.exec(select(Payment)).all():
            s.delete(row)
        s.commit()
    yield
    with Session(engine) as s:
        for row in s.exec(select(Invitation)).all():
            s.delete(row)
        for row in s.exec(select(WATemplate)).all():
            s.delete(row)
        for row in s.exec(select(Payment)).all():
            s.delete(row)
        for row in s.exec(select(PaymentAccount)).all():
            if row.id not in cuentas_antes:
                s.delete(row)
        for row in s.exec(select(WhatsAppChannel)).all():
            if row.id not in canales_antes:
                s.delete(row)
        for row in s.exec(select(User)).all():
            if row.id not in users_antes:
                s.delete(row)
        for row in s.exec(select(Tenant)).all():
            if row.id not in tenants_antes:
                s.delete(row)
            elif (row.plan, row.trial_hasta) != tenants_antes[row.id]:
                row.plan, row.trial_hasta = tenants_antes[row.id]
                s.add(row)
        s.commit()
        rows = s.exec(select(Tenant).order_by(Tenant.id)).all()
    data.TENANTS.clear()
    data.TENANTS.update({r.id: persist.tenant_dict(r) for r in rows})
    store.reset_demo()  # pedidos/carta a seed: el CSV no contamina a nadie


# ════════════════════════ A. Reportes CSV ════════════════════════

def _filas_csv(r) -> list[list[str]]:
    """Decodifica el CSV (BOM fuera) con csv de stdlib — el mismo formato
    que produce el endpoint (CRLF)."""
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    texto = r.text
    assert texto.startswith("\ufeff")  # BOM UTF-8 para Excel
    assert "\r\n" in texto  # CRLF (csv.writer por defecto)
    return list(csv.reader(io.StringIO(texto.lstrip("\ufeff"))))


def test_pedidos_csv_contenido_exacto(owner_headers):
    o = _crear_pedido(cliente="Csv Test",
                      items=[{"id": "f1", "cant": 2}, {"id": "f5", "cant": 1}],
                      direccion="Calle Csv 1")
    r = client.get("/api/reports/pedidos.csv?tenant=faro", headers=owner_headers)
    # attachment con el tenant en el nombre del archivo
    assert r.headers["content-disposition"] == \
        'attachment; filename="pedidos_faro.csv"'
    filas = _filas_csv(r)
    assert filas[0] == ["id", "fecha", "cliente", "items", "total",
                        "estado", "pago", "direccion"]
    fila = next(f for f in filas[1:] if f[0] == o["id"])
    assert fila == [o["id"], fila[1], "Csv Test",
                    "2x Ceviche clásico; 1x Inca Kola 500ml",
                    "75.00", "nuevo", "pendiente", "Calle Csv 1"]
    assert FECHA_RE.match(fila[1])


def test_ledger_csv_contenido_exacto(owner_headers):
    # culqi simulado: link + webhook → UNA fila verificado con comisión
    o = _crear_pedido(cliente="Ledger Csv", items=[{"id": "f1", "cant": 2}])
    link = client.post("/api/payments/culqi/link",
                       json={"tenant": "faro", "order_id": o["id"]}).json()
    assert client.post("/api/payments/culqi/webhook",
                       json={"reference_id": link["reference_id"]}).json()["ok"]
    # yape exacto → UNA fila verificado SIN comisión
    o2 = _crear_pedido(cliente="Yape Csv", items=[{"id": "f1", "cant": 1}])
    assert client.post("/api/payments/yape",
                       json={"order_id": o2["id"],
                             "monto_foto": o2["total"]}).json()["ok"] is True
    r = client.get("/api/reports/ledger.csv?tenant=faro", headers=owner_headers)
    assert r.headers["content-disposition"] == \
        'attachment; filename="ledger_faro.csv"'
    filas = _filas_csv(r)
    assert filas[0] == ["fecha", "gateway", "referencia", "monto",
                        "comision", "estado", "pedido", "detalle"]
    por_pedido = {f[6]: f for f in filas[1:]}
    f = por_pedido[o["id"]]
    assert f == [f[0], "culqi_simulado", link["reference_id"], "69.00",
                 "2.37", "verificado", o["id"],
                 "Pago verificado por webhook simulado"]
    assert FECHA_RE.match(f[0])
    f2 = por_pedido[o2["id"]]
    assert f2[1] == "yape" and f2[3] == "37.00" and f2[4] == "0.00"
    assert f2[5] == "verificado" and f2[6] == o2["id"]
    assert f2[7] == "match exacto + revisión humana OK (demo)"


def test_ledger_csv_ultimos_100(owner_headers):
    """El límite del tooltip: 105 filas en el ledger → el CSV lleva las
    últimas 100, la más reciente primero."""
    with Session(engine) as s:
        for n in range(105):
            s.add(Payment(tenant_id="faro", order_id=f"#9{n:03}", gateway="yape",
                          monto=1.0, estado="verificado", detalle="filler"))
        s.commit()
    r = client.get("/api/reports/ledger.csv?tenant=faro", headers=owner_headers)
    filas = _filas_csv(r)
    assert len(filas) == 101  # header + 100
    assert filas[1][6] == "#9104"  # id desc: la última insertada, primero


def test_csv_authz(staff_headers, owner_headers):
    """Permisos (contrato): pedidos.csv = manage_orders, ledger.csv =
    view_ledger + check_tenant_owner en ambas. Ver nota del docstring del
    módulo sobre el bullet "staff 403 en pedidos.csv"."""
    # sin token → 401 en ambas
    assert client.get("/api/reports/pedidos.csv?tenant=faro").status_code == 401
    assert client.get("/api/reports/ledger.csv?tenant=faro").status_code == 401
    # staff (manage_orders): SU panel se exporta; el dinero NO (view_ledger)
    assert client.get("/api/reports/pedidos.csv?tenant=faro",
                      headers=staff_headers).status_code == 200
    r = client.get("/api/reports/ledger.csv?tenant=faro", headers=staff_headers)
    assert r.status_code == 403 and r.json()["detail"] == \
        "Tu rol no permite view_ledger"
    # admin: ambos (tiene manage_orders y view_ledger)
    admin_headers = _crear_admin(owner_headers)
    assert client.get("/api/reports/pedidos.csv?tenant=faro",
                      headers=admin_headers).status_code == 200
    assert client.get("/api/reports/ledger.csv?tenant=faro",
                      headers=admin_headers).status_code == 200
    # cruzado: staff/admin de faro en brasa, y el dueño de brasa en faro
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    for h in (staff_headers, admin_headers):
        assert client.get("/api/reports/pedidos.csv?tenant=brasa",
                          headers=h).status_code == 403
    assert client.get("/api/reports/pedidos.csv?tenant=faro",
                      headers=brasa).status_code == 403
    assert client.get("/api/reports/ledger.csv?tenant=faro",
                      headers=brasa).status_code == 403
    # local desconocido → 404
    assert client.get("/api/reports/pedidos.csv?tenant=inventado",
                      headers=owner_headers).status_code == 404
    assert client.get("/api/reports/ledger.csv?tenant=inventado",
                      headers=owner_headers).status_code == 404


# ═══════════════ B. Cifrado de secretos en BD ═══════════════

def test_crypto_roundtrip_y_tolerancia():
    token = crypto.cifrar("sk_test_SECRETA")
    assert token != "sk_test_SECRETA" and token.startswith("gAAA")
    assert crypto.descifrar(token) == "sk_test_SECRETA"
    # tolerancia retro: plaintext legado (sin prefijo) va tal cual
    assert crypto.descifrar("tok_plain_legado") == "tok_plain_legado"
    # vacío no se toca; y cifrar es idempotente (jamás doble-cifrado)
    assert crypto.cifrar("") == "" and crypto.descifrar("") == ""
    assert crypto.cifrar(token) == token
    # descifrar NUNCA lanza: un "gAAA" corrupto cae al valor tal cual
    assert crypto.descifrar("gAAAA-no-es-un-token") == "gAAAA-no-es-un-token"


def test_secret_culqi_cifrada_en_bd_y_cargo_transparente(owner_headers,
                                                         monkeypatch):
    """Contrato B: guardar → la BD CRUDA no contiene el plaintext, y el
    flujo de cargo sigue funcionando (mock de crear_cargo_culqi)."""
    monkeypatch.setattr(payments, "validar_secret_culqi",
                        lambda sk: (True, ""))
    sk = "sk_test_SECRETA-123"
    r = client.post("/api/payments/cuenta", headers=owner_headers,
                    json={"tenant": "faro", "public_key": "pk_test_LOCAL",
                          "secret_key": sk})
    assert r.status_code == 200, r.text
    assert sk not in r.text  # jamás en la respuesta
    raw = _sql_columnas("paymentaccount", "secret_key")
    assert len(raw) == 1
    assert raw[0][0] != sk  # la BD cruda NO tiene el plaintext
    assert raw[0][0].startswith("gAAA")
    assert crypto.descifrar(raw[0][0]) == sk
    # uso transparente: el cargo recibe el plaintext (descifrado en el punto
    # de uso), no el token Fernet
    o = _crear_pedido(cliente="Cargo Cifrado")
    captura = {}

    def fake_cargo(sk_recibida, monto, token, email="cliente@demo.pe", timeout=30):
        captura.update(sk=sk_recibida)
        return {"id": "chr_ok", "outcome": {"type": "venta_exitosa"}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert captura["sk"] == sk


def test_token_whatsapp_cifrado_en_bd_y_uso_transparente(owner_headers,
                                                          monkeypatch):
    r = client.post("/api/whatsapp/setup", headers=owner_headers,
                    json={"tenant": "faro", "phone_number_id": "PNID-CIF",
                          "token": "TOK-CIFRADO"})
    assert r.status_code == 200 and "TOK-CIFRADO" not in r.text
    raw = _sql_columnas("whatsappchannel", "token")
    assert raw[0][0] != "TOK-CIFRADO"
    assert raw[0][0].startswith("gAAA")
    assert crypto.descifrar(raw[0][0]) == "TOK-CIFRADO"
    # send_whatsapp descifra en el punto de uso: Graph recibe el token real
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path, data=data, token=token)
        return {"messaging_product": "whatsapp", "messages": [{"id": "wamid.c"}]}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    whatsapp.send_whatsapp("faro", "51991234567", "prueba")
    assert captura["token"] == "TOK-CIFRADO"
    assert captura["path"] == "PNID-CIF/messages"


def test_recifrado_al_arranque(owner_headers):
    """Filas plaintext legadas (pre-cifrado) se re-cifran AL ARRANQUE:
    db.recifrar_plaintext es lo que init_db corre tras crear las tablas."""
    with Session(engine) as s:
        s.add(PaymentAccount(tenant_id="faro", provider="culqi",
                             public_key="pk_test_VIEJA",
                             secret_key="sk_PLAIN-LEGADO"))
        s.add(WhatsAppChannel(tenant_id="faro", phone_number_id="PN-VIEJO",
                              token="TOK-PLAIN-LEGADO"))
        s.commit()
    db.recifrar_plaintext()
    sk_raw = _sql_columnas("paymentaccount", "secret_key")[0][0]
    tok_raw = _sql_columnas("whatsappchannel", "token")[0][0]
    assert sk_raw.startswith("gAAA") and crypto.descifrar(sk_raw) == "sk_PLAIN-LEGADO"
    assert tok_raw.startswith("gAAA") and crypto.descifrar(tok_raw) == "TOK-PLAIN-LEGADO"
    # idempotente: re-corrrer el arranque no re-cifra lo ya cifrado
    db.recifrar_plaintext()
    assert _sql_columnas("paymentaccount", "secret_key")[0][0] == sk_raw
    assert _sql_columnas("whatsappchannel", "token")[0][0] == tok_raw


# ═══════════════ C. Invitaciones por enlace ═══════════════

def test_invitacion_ciclo_completo(owner_headers):
    email = _email("invitado")
    inv = _invitar(owner_headers, email)
    # forma exacta del POST: {token, url, expires_at} (enlace para copiar)
    assert set(inv) == {"token", "url", "expires_at"}
    assert inv["url"] == f"/invitar/{inv['token']}"
    expira = datetime.fromisoformat(inv["expires_at"])
    assert timedelta(days=6, hours=23) <= expira - _now_naive() <= timedelta(days=7)
    # GET pública (sin token): valida, con local/email/rol y sin secrets
    r = client.get(f"/api/invitaciones/{inv['token']}")
    assert r.status_code == 200
    d = r.json()
    assert d == {"valida": True, "local": "Cevichería El Faro",
                 "email": email, "rol": "staff"}
    # pendientes del equipo: id/email/rol/expires_at/url
    pend = client.get("/api/invitaciones?tenant=faro", headers=owner_headers).json()
    m = next(p for p in pend if p["email"] == email)
    assert m["rol"] == "staff" and m["url"] == inv["url"] and m["expires_at"]
    # aceptar: crea el user (rol/tenant de la invitación) y LOGUEA directo
    r = client.post(f"/api/invitaciones/{inv['token']}/aceptar",
                    json={"nombre": "Invitado Test", "password": "secreto123"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d) == {"access_token", "token_type", "user"}
    assert d["token_type"] == "bearer" and d["access_token"]
    assert d["user"]["email"] == email and d["user"]["rol"] == "staff"
    assert d["user"]["tenant_id"] == "faro" and d["user"]["nombre"] == "Invitado Test"
    # el token sirve (login directo) y el password también loguea
    me = client.get("/api/auth/me",
                    headers={"Authorization": f"Bearer {d['access_token']}"})
    assert me.status_code == 200 and me.json()["rol"] == "staff"
    assert login(email, "secreto123")
    team = client.get("/api/staff?tenant=faro", headers=owner_headers).json()
    assert email in {u["email"] for u in team}
    # tras aceptar: la pública dice NO valida con motivo, y re-aceptar 400
    d = client.get(f"/api/invitaciones/{inv['token']}").json()
    assert d["valida"] is False and d["motivo"] == "ya aceptada"
    r = client.post(f"/api/invitaciones/{inv['token']}/aceptar",
                    json={"nombre": "Otro", "password": "secreto123"})
    assert r.status_code == 400 and "ya fue aceptada" in r.json()["detail"]


def test_invitacion_expirada(owner_headers):
    email = _email("vencida")
    inv = _invitar(owner_headers, email)
    with Session(engine) as s:
        row = s.exec(select(Invitation).where(
            Invitation.token == inv["token"])).first()
        row.expires_at = _now_naive() - timedelta(days=1)
        s.add(row)
        s.commit()
    d = client.get(f"/api/invitaciones/{inv['token']}").json()
    assert d["valida"] is False and d["motivo"] == "expirada"
    r = client.post(f"/api/invitaciones/{inv['token']}/aceptar",
                    json={"nombre": "Tarde", "password": "secreto123"})
    assert r.status_code == 400 and "expiró" in r.json()["detail"]
    # la vencida NO estorba: re-invitar el mismo email la renueva
    assert _invitar(owner_headers, email)


def test_invitacion_revocar(owner_headers):
    email = _email("revocada")
    inv = _invitar(owner_headers, email)
    pend = client.get("/api/invitaciones?tenant=faro", headers=owner_headers).json()
    iid = next(p["id"] for p in pend if p["email"] == email)
    r = client.delete(f"/api/invitaciones/{iid}?tenant=faro", headers=owner_headers)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.get(f"/api/invitaciones/{inv['token']}").status_code == 404
    assert client.delete(f"/api/invitaciones/{iid}?tenant=faro",
                         headers=owner_headers).status_code == 404
    pend = client.get("/api/invitaciones?tenant=faro", headers=owner_headers).json()
    assert email not in {p["email"] for p in pend}
    # revocar la invitación de OTRO local desde el mío → 404 (no filtra)
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    inv_b = _invitar(brasa, _email("brasa-inv"), tenant="brasa")
    pend_b = client.get("/api/invitaciones?tenant=brasa", headers=brasa).json()
    iid_b = next(p["id"] for p in pend_b if p["url"] == inv_b["url"])
    assert client.delete(f"/api/invitaciones/{iid_b}?tenant=faro",
                         headers=owner_headers).status_code == 404


def test_invitacion_409_duplicados(owner_headers, staff_headers):
    # email ya en el equipo → 409
    r = client.post("/api/staff/invite", headers=owner_headers,
                    json={"tenant": "faro", "email": "cocina@demo.pe",
                          "rol": "staff"})
    assert r.status_code == 409 and "ya está en el equipo" in r.json()["detail"]
    # invitación pendiente VÁLIDA del mismo email → 409
    email = _email("dup")
    _invitar(owner_headers, email)
    r = client.post("/api/staff/invite", headers=owner_headers,
                    json={"tenant": "faro", "email": email, "rol": "staff"})
    assert r.status_code == 409 and "pendiente" in r.json()["detail"]
    # revocada → invitar de nuevo es la renovación natural
    pend = client.get("/api/invitaciones?tenant=faro", headers=owner_headers).json()
    iid = next(p["id"] for p in pend if p["email"] == email)
    client.delete(f"/api/invitaciones/{iid}?tenant=faro", headers=owner_headers)
    assert _invitar(owner_headers, email)
    # aceptada → el email YA está en el equipo → 409 de nuevo
    pend = client.get("/api/invitaciones?tenant=faro",
                      headers=owner_headers).json()
    tok = next(p["url"].rsplit("/", 1)[1] for p in pend if p["email"] == email)
    client.post(f"/api/invitaciones/{tok}/aceptar",
                json={"nombre": "Dup", "password": "secreto123"})
    r = client.post("/api/staff/invite", headers=owner_headers,
                    json={"tenant": "faro", "email": email, "rol": "staff"})
    assert r.status_code == 409


def test_invitacion_regla_solo_owner_crea_admins(owner_headers, staff_headers):
    # el owner SÍ invita admins
    assert _invitar(owner_headers, _email("nuevo-admin"), rol="admin")
    # el admin invita SOLO staff; invitar admin → 403
    admin_headers = _crear_admin(owner_headers)
    r = client.post("/api/staff/invite", headers=admin_headers,
                    json={"tenant": "faro", "email": _email("por-admin"),
                          "rol": "admin"})
    assert r.status_code == 403 and \
        r.json()["detail"] == "Solo el dueño puede invitar administradores"
    assert _invitar(admin_headers, _email("staff-por-admin"), rol="staff")
    # staff no tiene manage_team → 403 (aunque el rol sea staff)
    r = client.post("/api/staff/invite", headers=staff_headers,
                    json={"tenant": "faro", "email": _email("por-staff"),
                          "rol": "staff"})
    assert r.status_code == 403 and r.json()["detail"] == \
        "Tu rol no permite manage_team"
    # invitar NUNCA crea owner (422 del Literal) y sin sesión → 401
    r = client.post("/api/staff/invite", headers=owner_headers,
                    json={"tenant": "faro", "email": _email("owner-fake"),
                          "rol": "owner"})
    assert r.status_code == 422
    assert client.post("/api/staff/invite",
                       json={"tenant": "faro", "email": "x@y.pe",
                             "rol": "staff"}).status_code == 401
    # listado: staff 403, sin token 401, cruzado 403
    assert client.get("/api/invitaciones?tenant=faro",
                      headers=staff_headers).status_code == 403
    assert client.get("/api/invitaciones?tenant=faro").status_code == 401
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.get("/api/invitaciones?tenant=faro",
                      headers=brasa).status_code == 403


def test_invitacion_token_unico(owner_headers):
    a = _invitar(owner_headers, _email("tok-a"))
    b = _invitar(owner_headers, _email("tok-b"))
    assert a["token"] != b["token"]
    with Session(engine) as s:  # unique index real en la tabla
        assert s.exec(select(Invitation).where(
            Invitation.token == a["token"])).first() is not None


def test_aceptar_validaciones(owner_headers):
    inv = _invitar(owner_headers, _email("validar"))
    # password min 8 (mismo mínimo que register) y nombre requerido → 422
    r = client.post(f"/api/invitaciones/{inv['token']}/aceptar",
                    json={"nombre": "X", "password": "corta12"})
    assert r.status_code == 422
    r = client.post(f"/api/invitaciones/{inv['token']}/aceptar",
                    json={"nombre": "", "password": "secreto123"})
    assert r.status_code == 422
    # token desconocido: pública 404, aceptar 404
    assert client.get("/api/invitaciones/token-inexistente").status_code == 404
    r = client.post("/api/invitaciones/token-inexistente/aceptar",
                    json={"nombre": "X", "password": "secreto123"})
    assert r.status_code == 404
    # 409 si el email ya existe (contrato): se registró por otra vía
    email = _email("ya-registrado")
    _invitar(owner_headers, email)
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "secreto123",
                          "nombre": "Ocupado"})
    assert r.status_code == 201
    pend = client.get("/api/invitaciones?tenant=faro",
                      headers=owner_headers).json()
    token = next(p["url"].rsplit("/", 1)[1] for p in pend if p["email"] == email)
    r = client.post(f"/api/invitaciones/{token}/aceptar",
                    json={"nombre": "X", "password": "secreto123"})
    assert r.status_code == 409 and "ya está registrado" in r.json()["detail"]


# ═══════════════ D. Plantillas WhatsApp ═══════════════

def test_crear_plantilla_post_meta_mockeado(owner_headers, monkeypatch):
    """POST crea en Meta con la forma exacta y guarda el espejo con el
    estado que Meta devolvió TAL CUAL (PENDING_APPROVAL en test)."""
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path, data=data, method=method, token=token)
        return {"id": "TPL-META-1", "status": "PENDING_APPROVAL",
                "name": "promo_fin_de_semana", "language": "es",
                "category": "MARKETING", "components": []}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/plantillas", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "promo_fin_de_semana",
                          "categoria": "MARKETING", "lenguaje": "es",
                          "cuerpo": "¡Viernes de {{1}} con descuento!"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["estado"] == "PENDING_APPROVAL"  # tal cual, no traducido
    assert d["meta_id"] == "TPL-META-1"
    assert d["meta"] == {"id": "TPL-META-1", "status": "PENDING_APPROVAL",
                         "name": "promo_fin_de_semana", "language": "es",
                         "category": "MARKETING", "components": []}
    # la llamada a Graph: POST {WABA_ID}/message_templates con la forma Meta
    assert captura["path"] == f"{os.environ['META_WABA_ID']}/message_templates"
    assert captura["method"] == "POST"
    assert captura["token"] == os.environ["META_PERMANENT_TOKEN"]
    assert captura["data"] == {
        "name": "promo_fin_de_semana", "language": "es",
        "category": "MARKETING",
        "components": [{"type": "BODY",
                        "text": "¡Viernes de {{1}} con descuento!"}]}
    # el espejo quedó en la BD con ese estado
    with Session(engine) as s:
        row = s.exec(select(WATemplate).where(
            WATemplate.nombre == "promo_fin_de_semana")).first()
        assert row.estado == "PENDING_APPROVAL" and row.meta_id == "TPL-META-1"
        assert row.tenant_id == "faro" and row.cuerpo.startswith("¡Viernes")
        tid = row.id
    # GET (merge con Meta vacío) lista la local con SU estado
    monkeypatch.setattr(whatsapp, "graph_request",
                        lambda *a, **k: {"data": []})
    r = client.get("/api/whatsapp/plantillas?tenant=faro", headers=owner_headers)
    assert r.status_code == 200
    t = next(t for t in r.json() if t["nombre"] == "promo_fin_de_semana")
    assert t["estado"] == "PENDING_APPROVAL" and t["id"] == tid
    assert client.get("/api/whatsapp/plantillas?tenant=faro").status_code == 401


def test_plantillas_merge_best_effort(owner_headers, monkeypatch):
    # sin env del WABA: POST crea espejo "local" y NO llama a Graph
    llamadas = []
    monkeypatch.delenv("META_WABA_ID")
    monkeypatch.setattr(whatsapp, "graph_request",
                        lambda *a, **k: llamadas.append(1))
    r = client.post("/api/whatsapp/plantillas", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "promo_local",
                          "categoria": "UTILITY", "lenguaje": "es",
                          "cuerpo": "Tu pedido {{1}} está listo"})
    assert r.status_code == 201
    d = r.json()
    assert d["estado"] == "local" and d["meta"] is None and llamadas == []
    assert "META_WABA_ID" in d["nota"]
    # GET con Meta CAÍDO (env presente pero Graph lanza): best-effort
    monkeypatch.setenv("META_WABA_ID", "WABA-TEST")
    monkeypatch.setenv("META_PERMANENT_TOKEN", "TOK-TEST")

    def graph_roto(path, data=None, method="POST", token="", timeout=30):
        raise RuntimeError("sin red")

    monkeypatch.setattr(whatsapp, "graph_request", graph_roto)
    r = client.get("/api/whatsapp/plantillas?tenant=faro", headers=owner_headers)
    assert r.status_code == 200  # best-effort: Meta falló, locales alcanzan
    assert len(r.json()) == 1 and r.json()[0]["estado"] == "local"
    # GET con Meta OK: merge por nombre (Meta manda en estado) + las de Meta
    monkeypatch.setattr(whatsapp, "graph_request", lambda *a, **k: {"data": [
        {"id": "MT-9", "name": "promo_local", "status": "APPROVED",
         "language": "es", "category": "UTILITY",
         "components": [{"type": "BODY", "text": "Texto Meta"}]},
        {"id": "HW-1", "name": "hello_world", "status": "APPROVED",
         "language": "es", "category": "UTILITY",
         "components": [{"type": "BODY", "text": "Hello world"}]}]})
    r = client.get("/api/whatsapp/plantillas?tenant=faro", headers=owner_headers)
    tpls = {t["nombre"]: t for t in r.json()}
    assert len(tpls) == 2  # merge: la local y la de Meta son UNA
    assert tpls["promo_local"]["estado"] == "APPROVED"  # Meta manda
    assert tpls["promo_local"]["meta_id"] == "MT-9"
    assert tpls["promo_local"]["id"] == d["id"]  # fila local, borrable
    assert tpls["hello_world"]["id"] is None  # solo de Meta: no hay espejo
    assert tpls["hello_world"]["estado"] == "APPROVED"
    assert tpls["hello_world"]["cuerpo"] == "Hello world"


def test_crear_plantilla_meta_rechaza(owner_headers, monkeypatch):
    def graph_mal(path, data=None, method="POST", token="", timeout=30):
        raise whatsapp.GraphError(
            400, {"error": {"message": "(#100) Invalid parameter: name"}})

    monkeypatch.setattr(whatsapp, "graph_request", graph_mal)
    r = client.post("/api/whatsapp/plantillas", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "mala_plantilla",
                          "categoria": "MARKETING", "lenguaje": "es",
                          "cuerpo": "x"})
    assert r.status_code == 502
    assert "(#100) Invalid parameter: name" in r.json()["detail"]
    with Session(engine) as s:  # sin espejo: Meta no la creó
        assert s.exec(select(WATemplate).where(
            WATemplate.nombre == "mala_plantilla")).first() is None


def test_plantillas_validaciones_y_delete(owner_headers, staff_headers,
                                           monkeypatch):
    base = {"tenant": "faro", "categoria": "MARKETING", "lenguaje": "es",
            "cuerpo": "texto"}
    # nombre [a-z0-9_] (Meta), categoria/lenguaje Literals, cuerpo no vacío
    for payload in [{**base, "nombre": "Malo!"},
                    {**base, "nombre": "con espacio"},
                    {**base, "nombre": "ok_1", "categoria": "SOCIAL"},
                    {**base, "nombre": "ok_2", "lenguaje": "fr"},
                    {**base, "nombre": "ok_3", "cuerpo": ""}]:
        assert client.post("/api/whatsapp/plantillas", headers=owner_headers,
                           json=payload).status_code == 422, payload
    # authz: candado manage_settings (staff 403); GET solo Bearer
    monkeypatch.setattr(whatsapp, "graph_request", lambda *a, **k: {"data": []})
    assert client.post("/api/whatsapp/plantillas", headers=staff_headers,
                       json={**base, "nombre": "no_staff"}).status_code == 403
    assert client.get("/api/whatsapp/plantillas?tenant=faro",
                      headers=staff_headers).status_code == 200
    # alta local (sin env) y DELETE del espejo
    monkeypatch.delenv("META_WABA_ID")
    d = client.post("/api/whatsapp/plantillas", headers=owner_headers,
                    json={**base, "nombre": "para_borrar"}).json()
    assert client.delete(f"/api/whatsapp/plantillas/{d['id']}?tenant=faro",
                         headers=staff_headers).status_code == 403
    assert client.delete(f"/api/whatsapp/plantillas/{d['id']}?tenant=faro",
                         headers=owner_headers).json() == {"ok": True}
    assert client.delete(f"/api/whatsapp/plantillas/{d['id']}?tenant=faro",
                         headers=owner_headers).status_code == 404
    tpls = client.get("/api/whatsapp/plantillas?tenant=faro",
                      headers=owner_headers).json()
    assert all(t["nombre"] != "para_borrar" for t in tpls)
    # borrar la de OTRO local → 404 (no filtra existencia ajena)
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    d2 = client.post("/api/whatsapp/plantillas", headers=owner_headers,
                     json={**base, "tenant": "faro",
                           "nombre": "de_faro"}).json()
    assert client.delete(f"/api/whatsapp/plantillas/{d2['id']}?tenant=brasa",
                         headers=brasa).status_code == 404


def test_enviar_prueba_happy_path(owner_headers, monkeypatch):
    """El envío sale por el MISMO path de send_whatsapp pero type=template,
    SIEMPRE al WHATSAPP_QA_RECIPIENT del env (hello_world no está en el
    espejo y no hace falta: el que decide es Meta)."""
    monkeypatch.setenv("WHATSAPP_QA_RECIPIENT", "51999999999")
    monkeypatch.setenv("META_PHONE_NUMBER_ID", "PNID-QA-ENV")
    monkeypatch.setenv("META_PERMANENT_TOKEN", "TOK-QA-ENV")
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path, data=data, token=token)
        return {"messaging_product": "whatsapp",
                "messages": [{"id": "wamid.TPL"}]}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/plantillas/enviar", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "hello_world",
                          "lenguaje": "es"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True and d["enviado_a"] == "51999999999"
    assert d["meta"]["messages"][0]["id"] == "wamid.TPL"
    assert captura["path"] == "PNID-QA-ENV/messages"
    assert captura["token"] == "TOK-QA-ENV"
    assert captura["data"] == {"messaging_product": "whatsapp",
                               "to": "51999999999", "type": "template",
                               "template": {"name": "hello_world",
                                             "language": {"code": "es"},
                                             "components": []}}
    # authz: staff 403, sin token 401, cruzado 403
    assert client.post("/api/whatsapp/plantillas/enviar", headers=login(
        "cocina@demo.pe", "demo1234"),
        json={"tenant": "faro", "nombre": "hello_world",
              "lenguaje": "es"}).status_code == 403
    assert client.post("/api/whatsapp/plantillas/enviar",
                       json={"tenant": "faro", "nombre": "x",
                             "lenguaje": "es"}).status_code == 401
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.post("/api/whatsapp/plantillas/enviar", headers=brasa,
                       json={"tenant": "faro", "nombre": "hello_world",
                             "lenguaje": "es"}).status_code == 403


def test_enviar_prueba_errores(owner_headers, monkeypatch):
    monkeypatch.setenv("WHATSAPP_QA_RECIPIENT", "51999999999")
    monkeypatch.setenv("META_PHONE_NUMBER_ID", "PNID-QA-ENV")
    monkeypatch.setenv("META_PERMANENT_TOKEN", "TOK-QA-ENV")
    # error de Meta VERBATIM (contrato): 4xx de Graph sube tal cual
    def graph_rechaza(path, data=None, method="POST", token="", timeout=30):
        raise whatsapp.GraphError(
            400, {"error": {"message": "Template param 'name' is invalid"}})

    monkeypatch.setattr(whatsapp, "graph_request", graph_rechaza)
    r = client.post("/api/whatsapp/plantillas/enviar", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "no_aprobada",
                          "lenguaje": "es"})
    assert r.status_code == 502
    assert r.json()["detail"] == "Template param 'name' is invalid"
    # sin WHATSAPP_QA_RECIPIENT → 400 honesto
    monkeypatch.delenv("WHATSAPP_QA_RECIPIENT")
    r = client.post("/api/whatsapp/plantillas/enviar", headers=owner_headers,
                    json={"tenant": "faro", "nombre": "hello_world",
                          "lenguaje": "es"})
    assert r.status_code == 400 and "WHATSAPP_QA_RECIPIENT" in r.json()["detail"]


# ═══════════════ E. Planes del SaaS ═══════════════

def test_get_planes_publico():
    r = client.get("/api/planes")  # público: sin Bearer
    assert r.status_code == 200
    assert r.json() == [
        {"id": "trial", "nombre": "Prueba", "precio": 0,
         "detalle": "14 días completos"},
        {"id": "basico", "nombre": "Básico", "precio": 49,
         "detalle": "1 local + chatbot + inbox"},
        {"id": "pro", "nombre": "Pro", "precio": 99,
         "detalle": "+ KDS, ledger, plantillas"},
    ]


def test_patch_plan_owner(owner_headers):
    r = client.patch("/api/tenants/faro/plan", headers=owner_headers,
                     json={"plan": "pro"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["plan"] == "pro"
    # nota honesta del cobro (Culqi Suscripciones pendiente)
    assert "manual" in d["nota"] and "Culqi Suscripciones" in d["nota"]
    # espejo + BD dicen lo mismo
    assert data.TENANTS["faro"]["plan"] == "pro"
    with Session(engine) as s:
        assert s.get(Tenant, "faro").plan == "pro"
    # cambio válido entre planes activables
    assert client.patch("/api/tenants/faro/plan", headers=owner_headers,
                        json={"plan": "basico"}).json()["plan"] == "basico"
    # plan inventado / volver a trial → 422 (Literal)
    assert client.patch("/api/tenants/faro/plan", headers=owner_headers,
                       json={"plan": "premium"}).status_code == 422
    assert client.patch("/api/tenants/faro/plan", headers=owner_headers,
                       json={"plan": "trial"}).status_code == 422
    # 404 de local desconocido y 403 cruzado
    assert client.patch("/api/tenants/inventado/plan", headers=owner_headers,
                       json={"plan": "pro"}).status_code == 404
    brasa, _ = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")
    assert client.patch("/api/tenants/faro/plan", headers=brasa,
                        json={"plan": "pro"}).status_code == 403


def test_patch_plan_solo_owner(staff_headers, owner_headers):
    # staff → 403 (contrato: PATCH owner); admin tampoco: es del dueño
    assert client.patch("/api/tenants/faro/plan", headers=staff_headers,
                        json={"plan": "basico"}).status_code == 403
    admin_headers = _crear_admin(owner_headers)
    assert client.patch("/api/tenants/faro/plan", headers=admin_headers,
                        json={"plan": "basico"}).status_code == 403
    assert client.patch("/api/tenants/faro/plan",
                        json={"plan": "basico"}).status_code == 401
    with Session(engine) as s:  # nada cambió
        assert s.get(Tenant, "faro").plan == "basico"


def test_trial_en_registro_y_seed_basico():
    """Contrato E: registro nuevo → trial 14 días; los 3 demo son "basico"
    (decisión documentada: el demo no expira, trial SOLO en el alta)."""
    email = _email("trial")
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "secreto123",
                          "nombre": "Dueño Trial",
                          "negocio": {"nombre": "Cevichería Trial",
                                      "distrito": "Surco"}})
    assert r.status_code == 201
    slug = r.json()["tenant_id"]
    tenants = {t["id"]: t for t in client.get("/api/tenants").json()}
    t = tenants[slug]
    assert t["plan"] == "trial"
    trial_hasta = datetime.fromisoformat(t["trial_hasta"])
    assert timedelta(days=13, hours=23) <= trial_hasta - _now_naive() \
        <= timedelta(days=14)
    # el alta por POST /api/tenants también es un local NUEVO → trial
    headers, _ = registrar_y_loguear()
    d = client.post("/api/tenants", headers=headers,
                    json={"nombre": "Local Trial Dos", "distrito": "Surco"}
                    ).json()
    assert d["plan"] == "trial" and d["trial_hasta"]
    # los 3 seed: basico, sin trial
    for tid in ("faro", "brasa", "juana"):
        assert tenants[tid]["plan"] == "basico"
        assert tenants[tid]["trial_hasta"] is None
