"""Cuenta Culqi POR LOCAL (change pasarela-culqi): CRUD con owner, validación
EN VIVO de la secret (monkeypatch de validar_secret_culqi, patrón graph_request
de test_whatsapp), cargo con las llaves del tenant (mock de crear_cargo_culqi)
y el rewire de /api/payments/config + /api/payments/culqi/charge."""
import json

import pytest
from conftest import client
from sqlmodel import Session, select

from app import crypto, payments
from app.db import engine
from app.models import PaymentAccount

MOD_DETAIL = "Módulo desactivado: actívalo en Configuración"

CUENTA = {"tenant": "faro", "public_key": "pk_test_LOCAL123",
          "secret_key": "sk_test_DEL-LOCAL"}


@pytest.fixture(autouse=True)
def _sin_cuentas(monkeypatch):
    """Tests herméticos: arrancan y terminan sin cuentas (la BD de tests es un
    solo archivo compartido por toda la corrida) y sin las env CULQI_*."""
    monkeypatch.delenv("CULQI_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("CULQI_SECRET_KEY", raising=False)

    def _limpiar():
        with Session(engine) as session:
            for a in session.exec(select(PaymentAccount)).all():
                session.delete(a)
            session.commit()

    _limpiar()
    yield
    _limpiar()


def conectar_cuenta(monkeypatch, headers, tenant="faro",
                    pk="pk_test_LOCAL123", sk="sk_test_DEL-LOCAL") -> dict:
    """Helper: da de alta la cuenta del tenant con la validación mocked OK."""
    monkeypatch.setattr(payments, "validar_secret_culqi",
                        lambda secret: (True, ""))
    r = client.post("/api/payments/cuenta", headers=headers,
                    json={"tenant": tenant, "public_key": pk, "secret_key": sk})
    assert r.status_code == 200, r.text
    return r.json()


def _crear_pedido(tenant="faro", cliente="Pago Test"):
    r = client.post("/api/orders", json={"tenant": tenant, "cliente": cliente,
                                         "items": [{"id": "f1", "cant": 1}],
                                         "direccion": "Calle Test 1"})
    assert r.status_code == 200
    return r.json()


def _filas(tenant="faro") -> list[PaymentAccount]:
    with Session(engine) as session:
        return session.exec(select(PaymentAccount).where(
            PaymentAccount.tenant_id == tenant)).all()


# ── authz del CRUD ──

def test_cuenta_sin_token_401():
    assert client.get("/api/payments/cuenta?tenant=faro").status_code == 401
    r = client.post("/api/payments/cuenta", json=CUENTA)
    assert r.status_code == 401
    r = client.delete("/api/payments/cuenta?tenant=faro")
    assert r.status_code == 401


def test_cuenta_staff_y_owner_cruzado_403(staff_headers, owner_headers):
    # staff (cocina) no configura la pasarela del local
    assert client.post("/api/payments/cuenta", headers=staff_headers,
                       json=CUENTA).status_code == 403
    assert client.delete("/api/payments/cuenta?tenant=faro",
                         headers=staff_headers).status_code == 403
    # dueño de OTRO local tampoco (patrón _check_tenant_owner de whatsapp)
    brasa = client.post("/api/auth/register",
                        json={"email": "owner-brasa@test.pe", "password": "secreto123",
                              "nombre": "Owner Brasa", "tenant_id": "brasa"})
    assert brasa.status_code == 201
    brasa_headers = {"Authorization": "Bearer " + client.post(
        "/api/auth/login", json={"email": "owner-brasa@test.pe",
                                 "password": "secreto123"}).json()["access_token"]}
    assert client.post("/api/payments/cuenta", headers=brasa_headers,
                       json=CUENTA).status_code == 403
    # pero GET solo exige Bearer (como whatsapp /status): staff sí puede VER
    r = client.get("/api/payments/cuenta?tenant=faro", headers=staff_headers)
    assert r.status_code == 200 and r.json()["estado"] == "desconectada"
    assert client.get("/api/payments/cuenta?tenant=inventado",
                      headers=owner_headers).status_code == 404


# ── alta + validación EN VIVO de la secret ──

def test_setup_valida_en_vivo_y_guarda_conectada(owner_headers, monkeypatch):
    llamadas = []

    def fake_validar(sk):
        llamadas.append(sk)
        return True, ""

    monkeypatch.setattr(payments, "validar_secret_culqi", fake_validar)
    r = client.post("/api/payments/cuenta", headers=owner_headers, json=CUENTA)
    assert r.status_code == 200, r.text
    d = r.json()
    assert llamadas == ["sk_test_DEL-LOCAL"]  # se validó justo lo que llegó
    assert d["estado"] == "conectada"
    assert d["public_key"] == "pk_test_…"  # primeros 8 + …, NUNCA completa
    assert d["provider"] == "culqi" and d["verified_at"]
    assert "sk_test_DEL-LOCAL" not in json.dumps(d)  # la secret jamás viaja

    filas = _filas()
    assert len(filas) == 1
    # endurecer-local B (ajuste mínimo del assert original): la secret ya NO
    # se guarda plaintext — en la BD cruda viaja cifrada (Fernet, "gAAA…") y
    # crypto.descifrar la recupera. El plaintext JAMÁS está en la fila.
    assert filas[0].secret_key != "sk_test_DEL-LOCAL"
    assert filas[0].secret_key.startswith("gAAA")
    assert crypto.descifrar(filas[0].secret_key) == "sk_test_DEL-LOCAL"
    assert filas[0].estado == "conectada" and filas[0].verified_at

    # GET refleja lo mismo, sin secret
    d2 = client.get("/api/payments/cuenta?tenant=faro",
                    headers=owner_headers).json()
    assert d2["estado"] == "conectada" and d2["public_key"] == "pk_test_…"
    assert d2["verified_at"] == d["verified_at"]
    assert "sk_test" not in json.dumps(d2)


def test_setup_secret_rechazada_400_y_no_guarda(owner_headers, monkeypatch):
    def fake_validar(sk):
        return False, "Llave secreta inválida o expirada"

    monkeypatch.setattr(payments, "validar_secret_culqi", fake_validar)
    r = client.post("/api/payments/cuenta", headers=owner_headers, json=CUENTA)
    assert r.status_code == 400
    assert r.json()["detail"] == ("Llave secreta rechazada por Culqi: "
                                  "Llave secreta inválida o expirada")
    assert _filas() == []  # nada se guarda sin validación


def test_setup_culqi_no_disponible_502(owner_headers, monkeypatch):
    def fake_validar(sk):
        raise payments.CulqiError(None, "connection timed out")

    monkeypatch.setattr(payments, "validar_secret_culqi", fake_validar)
    r = client.post("/api/payments/cuenta", headers=owner_headers, json=CUENTA)
    assert r.status_code == 502
    assert "No se pudo validar la llave con Culqi" in r.json()["detail"]
    assert _filas() == []  # 502 honesto: no guarda ni inventa un rechazo


def test_setup_public_key_mala_no_llama_culqi(owner_headers, monkeypatch):
    llamadas = []

    def fake_validar(sk):
        llamadas.append(sk)
        return True, ""

    monkeypatch.setattr(payments, "validar_secret_culqi", fake_validar)
    r = client.post("/api/payments/cuenta", headers=owner_headers,
                    json={"tenant": "faro", "public_key": "no-es-una-pk",
                          "secret_key": "sk_test_X"})
    assert r.status_code == 400 and "pk_test_" in r.json()["detail"]
    assert llamadas == []  # el formato de la pk es local: cero llamadas a Culqi
    # pk_live_ también es un formato válido; la validación viva es SOLO de la sk
    r = client.post("/api/payments/cuenta", headers=owner_headers,
                    json={"tenant": "faro", "public_key": "pk_live_X",
                          "secret_key": "sk_test_X"})
    assert r.status_code == 200 and r.json()["public_key"] == "pk_live_…"
    assert llamadas == ["sk_test_X"]


def test_setup_es_upsert_un_local_una_cuenta(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers, sk="sk_test_VIEJA")
    d = conectar_cuenta(monkeypatch, owner_headers, pk="pk_live_NUEVA",
                        sk="sk_live_NUEVA")
    assert d["public_key"] == "pk_live_…" and d["estado"] == "conectada"
    filas = _filas()
    assert len(filas) == 1  # upsert: reemplaza, no duplica
    assert filas[0].public_key == "pk_live_NUEVA"
    # endurecer-local B: cifrada en la BD, descifrable en el punto de uso
    assert crypto.descifrar(filas[0].secret_key) == "sk_live_NUEVA"


# ── DELETE: vuelta a SIMULADO ──

def test_delete_borra_cuenta_y_config_cae_a_simulada(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers)
    monkeypatch.setenv("CULQI_PUBLIC_KEY", "pk_test_FALLBACK-ENV")
    cfg = client.get("/api/payments/config?tenant=faro").json()
    assert cfg["culqi_estado"] == "conectada"

    r = client.delete("/api/payments/cuenta?tenant=faro", headers=owner_headers)
    assert r.status_code == 200 and r.json()["estado"] == "desconectada"
    assert r.json()["ok"] is True
    assert _filas() == []

    # GET vuelve a desconectada y el config cae al env → SIMULADO
    d = client.get("/api/payments/cuenta?tenant=faro",
                   headers=owner_headers).json()
    assert d == {"estado": "desconectada", "public_key": None,
                 "verified_at": None, "provider": "culqi"}
    cfg = client.get("/api/payments/config?tenant=faro").json()
    assert cfg["culqi_estado"] == "simulada"
    assert cfg["culqi_pk"] == "pk_test_FALLBACK-ENV"
    assert cfg["culqi_pk_enmascarada"] is None

    # idempotente: borrar sin cuenta no explota
    r = client.delete("/api/payments/cuenta?tenant=faro", headers=owner_headers)
    assert r.status_code == 200 and r.json()["estado"] == "desconectada"


# ── /api/payments/config: pk del tenant vs env ──

def test_config_devuelve_pk_y_estado_del_tenant(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers, pk="pk_test_LOCAL123")
    monkeypatch.setenv("CULQI_PUBLIC_KEY", "pk_test_FALLBACK-ENV")
    cfg = client.get("/api/payments/config?tenant=faro").json()
    # la cuenta del tenant GANA sobre el env; el front recibe la pk COMPLETA
    assert cfg["culqi_pk"] == "pk_test_LOCAL123"
    assert cfg["culqi_estado"] == "conectada"
    assert cfg["culqi_pk_enmascarada"] == "pk_test_…"
    # la forma existente se mantiene
    assert cfg["yape_qr"] == "YA-FARO-123" and cfg["tenant"]
    assert "sk_test_DEL-LOCAL" not in json.dumps(cfg)


def test_config_sin_cuenta_cae_al_env_simulada(owner_headers, monkeypatch):
    cfg = client.get("/api/payments/config?tenant=faro").json()
    assert cfg["culqi_pk"] == "" and cfg["culqi_estado"] == "simulada"
    assert cfg["culqi_pk_enmascarada"] is None

    monkeypatch.setenv("CULQI_PUBLIC_KEY", "pk_test_FALLBACK-ENV")
    cfg = client.get("/api/payments/config?tenant=faro").json()
    assert cfg["culqi_pk"] == "pk_test_FALLBACK-ENV"
    assert cfg["culqi_estado"] == "simulada"


# ── /api/payments/culqi/charge: sk del tenant, env como fallback ──

def test_charge_usa_la_secret_del_tenant(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers, sk="sk_test_DEL-LOCAL")
    o = _crear_pedido()
    captura = {}

    def fake_cargo(sk, monto, token, email="cliente@demo.pe", timeout=30):
        captura.update(sk=sk, monto=monto, token=token)
        return {"id": "chr_123", "outcome": {"type": "venta_exitosa",
                                            "user_message": "Venta exitosa."}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert captura["sk"] == "sk_test_DEL-LOCAL"  # la del LOCAL, no la del env
    assert captura["monto"] == int(round(o["total"] * 100))
    assert captura["token"] == "tkn_test"
    assert d["ok"] is True and d["charge_id"] == "chr_123"
    assert d["order"]["pago"] == "pagado_culqi_real"
    assert "pagado_culqi_real" in d["order"]["timeline"]


def test_charge_sin_cuenta_cae_a_la_env(owner_headers, monkeypatch):
    monkeypatch.setenv("CULQI_SECRET_KEY", "sk_test_FALLBACK-ENV")
    o = _crear_pedido()
    captura = {}

    def fake_cargo(sk, monto, token, email="cliente@demo.pe", timeout=30):
        captura.update(sk=sk)
        return {"id": "chr_env", "outcome": {"type": "venta_exitosa"}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert captura["sk"] == "sk_test_FALLBACK-ENV"  # fallback legacy del prototipo


def test_charge_sin_cuenta_ni_env_orienta_al_simulado(monkeypatch):
    o = _crear_pedido()
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 400
    assert "CULQI_SECRET_KEY" in r.json()["detail"]


def test_charge_culqi_rechaza_http_502(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers)
    o = _crear_pedido()

    def fake_cargo(sk, monto, token, email="cliente@demo.pe", timeout=30):
        raise payments.CulqiError(402, {"merchant_message": "Fondos insuficientes"})

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 502
    assert "Culqi rechazó el cargo: Fondos insuficientes" == r.json()["detail"]
    # el rechazo queda en el timeline y persiste
    o2 = next(x for x in client.get("/api/orders?tenant=faro",
                                   headers=owner_headers).json()
              if x["id"] == o["id"])
    assert "culqi_rechazado" in o2["timeline"]


def test_charge_sin_contacto_con_culqi_502(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers)
    o = _crear_pedido()

    def fake_cargo(sk, monto, token, email="cliente@demo.pe", timeout=30):
        raise payments.CulqiError(None, "connection timed out")

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 502
    assert "No se pudo contactar a Culqi" in r.json()["detail"]


def test_charge_outcome_rechazado_no_paga(owner_headers, monkeypatch):
    conectar_cuenta(monkeypatch, owner_headers)
    o = _crear_pedido()

    def fake_cargo(sk, monto, token, email="cliente@demo.pe", timeout=30):
        return {"id": "chr_x", "outcome": {"type": "card_error",
                                           "user_message": "Tarjeta rechazada"}}

    monkeypatch.setattr(payments, "crear_cargo_culqi", fake_cargo)
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is False and d["motivo"] == "Tarjeta rechazada"
    assert d["order"]["pago"] == "pendiente"  # sigue pendiente, sin pagar


# ── gating real del módulo pagos ──

def test_gating_pagos_403_cuenta_setup(owner_headers, monkeypatch):
    r = client.patch("/api/modules/pagos", headers=owner_headers,
                     json={"tenant": "faro", "enabled": False})
    assert r.status_code == 200
    monkeypatch.setattr(payments, "validar_secret_culqi", lambda sk: (True, ""))
    r = client.post("/api/payments/cuenta", headers=owner_headers, json=CUENTA)
    assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    assert _filas() == []  # con el módulo apagado no se guarda nada
    # reactivado, el alta pasa
    client.patch("/api/modules/pagos", headers=owner_headers,
                 json={"tenant": "faro", "enabled": True})
    r = client.post("/api/payments/cuenta", headers=owner_headers, json=CUENTA)
    assert r.status_code == 200 and r.json()["estado"] == "conectada"
