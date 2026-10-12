"""Registro de módulos y toggles con gating REAL (modulos-mvp, Fase A)."""
import uuid

from conftest import client, registrar_y_loguear

from app import whatsapp

MOD_DETAIL = "Módulo desactivado: actívalo en Configuración"


def test_modules_listado_seed_todo_on():
    r = client.get("/api/modules?tenant=faro")
    assert r.status_code == 200
    mods = {m["key"]: m for m in r.json()}
    assert set(mods) == {"whatsapp", "inbox", "pagos", "kds", "carta"}
    assert all(m["enabled"] is True for m in mods.values())
    assert mods["whatsapp"]["nombre"] == "Conectar WhatsApp"
    assert mods["whatsapp"]["server_gated"] is True
    assert mods["inbox"]["server_gated"] is True
    assert mods["pagos"]["server_gated"] is True
    assert mods["kds"]["server_gated"] is False   # solo flag para el front
    assert mods["carta"]["server_gated"] is False
    for m in mods.values():
        assert m["descripcion"]  # siempre hay descripción para las cards


def test_module_patch_owner_on_off_y_staff_403(owner_headers, staff_headers):
    r = client.patch("/api/modules/pagos", headers=owner_headers,
                     json={"tenant": "faro", "enabled": False})
    assert r.status_code == 200
    assert r.json()["key"] == "pagos" and r.json()["enabled"] is False
    # gating real: /api/payments/* responde 403 con el mensaje exacto
    r = client.get("/api/payments/config?tenant=faro")
    assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    r = client.post("/api/payments/culqi/link",
                    json={"tenant": "faro", "order_id": "#101"})
    assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    # staff no puede tocar los módulos
    r = client.patch("/api/modules/pagos", headers=staff_headers,
                     json={"tenant": "faro", "enabled": True})
    assert r.status_code == 403
    # sin token tampoco
    r = client.patch("/api/modules/pagos", json={"tenant": "faro", "enabled": True})
    assert r.status_code == 401
    # el owner re-activa y el gating libera
    r = client.patch("/api/modules/pagos", headers=owner_headers,
                     json={"tenant": "faro", "enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert client.get("/api/payments/config?tenant=faro").status_code == 200


def test_module_patch_validaciones(owner_headers):
    assert client.patch("/api/modules/no-existe", headers=owner_headers,
                        json={"tenant": "faro", "enabled": True}).status_code == 404
    assert client.patch("/api/modules/pagos", headers=owner_headers,
                        json={"tenant": "inventado", "enabled": True}).status_code == 404
    # dueño de OTRO tenant no apaga los módulos de faro
    other = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    r = client.patch("/api/modules/pagos", headers=other,
                     json={"tenant": "faro", "enabled": False})
    assert r.status_code == 403


def test_gating_inbox_403_y_chat_legacy_sigue():
    juana_owner = registrar_y_loguear(nombre="Owner Juana", tenant_id="juana")[0]
    r = client.patch("/api/modules/inbox", headers=juana_owner,
                     json={"tenant": "juana", "enabled": False})
    assert r.status_code == 200
    for path in ["/api/conversations?tenant=juana",
                 "/api/canned?tenant=juana"]:
        r = client.get(path, headers=juana_owner)
        assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    # el simulador legacy sigue funcionando con inbox OFF (canal demo apagado)
    wa = f"legacy-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/chat", json={"tenant": "juana", "customer": wa,
                                      "message": "menu"})
    assert r.status_code == 200 and "Carta hoy" in r.json()["reply"]
    # ...pero NO genera conversación: el inbox está desactivado
    r = client.patch("/api/modules/inbox", headers=juana_owner,
                     json={"tenant": "juana", "enabled": True})
    assert r.status_code == 200
    convs = client.get("/api/conversations?tenant=juana",
                       headers=juana_owner).json()
    assert all(c["wa_id"] != wa for c in convs)


def test_gating_pagos_403_endpoints(owner_headers):
    juana_owner = registrar_y_loguear(nombre="Owner Juana", tenant_id="juana")[0]
    o = client.post("/api/orders", json={
        "tenant": "juana", "cliente": "Gate",
        "items": [{"id": "j1", "cant": 1}], "direccion": "Calle 1"}).json()
    r = client.patch("/api/modules/pagos", headers=juana_owner,
                     json={"tenant": "juana", "enabled": False})
    assert r.status_code == 200
    assert client.get("/api/payments/config?tenant=juana").status_code == 403
    r = client.post("/api/payments/culqi/link",
                    json={"tenant": "juana", "order_id": o["id"]})
    assert r.status_code == 403
    r = client.post("/api/payments/yape", json={"order_id": o["id"], "monto_foto": 15})
    assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tk"})
    assert r.status_code == 403
    # faro (módulo ON) sigue pagando con normalidad: el toggle es por tenant
    assert client.get("/api/payments/config?tenant=faro").status_code == 200


def test_gating_whatsapp_register_webhook(owner_headers, monkeypatch):
    # sin red en tests: status consulta Meta para la callback registrada
    monkeypatch.setattr(whatsapp, "graph_request", lambda *a, **k: {"data": []})
    r = client.patch("/api/modules/whatsapp", headers=owner_headers,
                     json={"tenant": "faro", "enabled": False})
    assert r.status_code == 200
    # register-webhook cae bajo /api/whatsapp/* (solo status/setup exentos)
    r = client.post("/api/whatsapp/register-webhook", headers=owner_headers,
                    json={"tenant": "faro", "callback_url": "https://x.example/webhook/whatsapp"})
    assert r.status_code == 403 and r.json()["detail"] == MOD_DETAIL
    # los exentos responden (status exige Bearer pero no el módulo)
    assert client.get("/api/whatsapp/status?tenant=faro").status_code == 401
    assert client.get("/api/whatsapp/status?tenant=faro",
                      headers=owner_headers).status_code == 200
    r = client.post("/api/whatsapp/setup", headers=owner_headers,
                    json={"tenant": "faro", "phone_number_id": "X", "token": "Y"})
    assert r.status_code == 200 and r.json()["estado"] == "conectado"
