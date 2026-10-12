"""WhatsApp Meta Cloud API: verificación, firma, mensajes entrantes, handoff
y Graph API (monkeypatcheada salvo el test gated por RUN_META_TESTS)."""
import hashlib
import hmac
import json
import os
import uuid

import pytest
from conftest import client, registrar_y_loguear

from app import inbox, whatsapp


def wa_payload(wa_id: str, text: str, name: str = "Cliente WA") -> dict:
    """Forma real de un evento de mensaje de texto de Meta."""
    return {"object": "whatsapp", "entry": [{"id": "E1", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "1617", "phone_number_id": "PNID"},
        "contacts": [{"profile": {"name": name}, "wa_id": wa_id}],
        "messages": [{"from": wa_id, "id": f"wamid.{uuid.uuid4().hex[:8]}",
                      "timestamp": "1760000000", "type": "text",
                      "text": {"body": text}}]}}]}]}


def wa_id_unico() -> str:
    return "5199" + uuid.uuid4().hex[:9]


@pytest.fixture()
def no_send(monkeypatch):
    """Sin envíos reales: captura las llamadas de whatsapp.py e inbox.py."""
    calls = []

    def fake(tenant, to, text):
        calls.append((tenant, to, text))
        return {"messaging_product": "whatsapp", "messages": [{"id": "wamid.fake"}]}

    monkeypatch.setattr(whatsapp, "send_whatsapp", fake)
    monkeypatch.setattr(inbox, "send_whatsapp", fake)
    return calls


def conv_de(tenant: str, wa_id: str, headers) -> dict:
    convs = client.get(f"/api/conversations?tenant={tenant}", headers=headers).json()
    return next(c for c in convs if c["wa_id"] == wa_id)


# ── verificación del webhook (GET hub.challenge) ──

def test_webhook_verify_retorna_challenge():
    tok = os.environ["META_VERIFY_TOKEN"]  # cargado del .env por python-dotenv
    r = client.get("/webhook/whatsapp", params={
        "hub.mode": "subscribe", "hub.verify_token": tok, "hub.challenge": "cha-123"})
    assert r.status_code == 200 and r.text == "cha-123"


def test_webhook_verify_token_malo_403():
    r = client.get("/webhook/whatsapp", params={
        "hub.mode": "subscribe", "hub.verify_token": "no-es-el-token",
        "hub.challenge": "cha-123"})
    assert r.status_code == 403
    # sin modo subscribe tampoco pasa
    r = client.get("/webhook/whatsapp", params={
        "hub.mode": "otro", "hub.verify_token": os.environ["META_VERIFY_TOKEN"],
        "hub.challenge": "cha"})
    assert r.status_code == 403


# ── POST webhook: firma y mensajes entrantes ──

def test_webhook_firma_invalida_403():
    r = client.post("/webhook/whatsapp", json=wa_payload("51999999999", "menu"),
                    headers={"X-Hub-Signature-256": "sha256=deadbeef"})
    assert r.status_code == 403


def test_webhook_firma_valida_procesa(no_send):
    raw = json.dumps(wa_payload("51988888", "menu")).encode()
    sig = "sha256=" + hmac.new(os.environ["META_APP_SECRET"].encode(), raw,
                               hashlib.sha256).hexdigest()
    r = client.post("/webhook/whatsapp", content=raw,
                    headers={"Content-Type": "application/json",
                             "X-Hub-Signature-256": sig})
    assert r.status_code == 200 and r.json()["mensajes"] == 1


def test_webhook_mensaje_entrante_crea_conversacion_y_responde_bot(
        owner_headers, no_send):
    wa = wa_id_unico()
    r = client.post("/webhook/whatsapp", json=wa_payload(wa, "menu", name="María GP"))
    assert r.status_code == 200 and r.json() == {"ok": True, "mensajes": 1}
    conv = conv_de("faro", wa, owner_headers)
    assert conv["canal"] == "whatsapp" and conv["cliente"] == "María GP"
    assert conv["estado"] == "bot" and conv["unread"] == 1
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot"]
    assert "Carta hoy" in msgs[1]["body"]
    # el bot respondió POR WhatsApp al remitente correcto
    assert no_send == [("faro", wa, msgs[1]["body"])]


def test_webhook_statuses_no_hace_nada(no_send):
    payload = {"entry": [{"changes": [{"value": {"statuses": [
        {"id": "wamid.1", "status": "delivered", "recipient_id": "5199"},
        {"id": "wamid.2", "status": "read", "recipient_id": "5199"}]}}]}]}
    r = client.post("/webhook/whatsapp", json=payload)
    assert r.status_code == 200 and r.json()["mensajes"] == 0


def test_webhook_multitenant_resuelve_tenant_por_phone_number_id(
        owner_headers, no_send):
    """Un webhook, muchos locales: metadata.phone_number_id identifica el canal
    y este al tenant. El mensaje nace bajo brasa y el bot responde SU carta."""
    from sqlmodel import Session, select

    from app.db import engine
    from app.models import WhatsAppChannel

    with Session(engine) as session:
        for ch in session.exec(select(WhatsAppChannel).where(
                WhatsAppChannel.tenant_id == "brasa")).all():
            session.delete(ch)
        session.add(WhatsAppChannel(tenant_id="brasa", phone_number_id="999",
                                    token="TOK-BRASA"))
        session.commit()

    wa = wa_id_unico()
    payload = wa_payload(wa, "menu", name="Cliente Brasa")
    payload["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = "999"
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(os.environ["META_APP_SECRET"].encode(), raw,
                               hashlib.sha256).hexdigest()
    r = client.post("/webhook/whatsapp", content=raw,
                    headers={"Content-Type": "application/json",
                             "X-Hub-Signature-256": sig})
    assert r.status_code == 200 and r.json() == {"ok": True, "mensajes": 1}

    # la conversación nace bajo el tenant brasa (no bajo el faro default)
    conv = conv_de("brasa", wa, owner_headers)
    assert conv["tenant_id"] == "brasa" and conv["cliente"] == "Cliente Brasa"
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot"]
    assert "Pollo entero" in msgs[1]["body"]  # la carta de brasa, no la de faro
    assert "Ceviche" not in msgs[1]["body"]
    # el envío salió por el canal del tenant brasa
    assert no_send[-1][0] == "brasa" and no_send[-1][1] == wa


def test_webhook_sin_canal_cae_al_tenant_default(no_send, monkeypatch):
    """phone_number_id sin canal registrado: default del env META_TENANT (o faro)."""
    monkeypatch.setenv("META_TENANT", "juana")
    wa = wa_id_unico()
    payload = wa_payload(wa, "menu")
    payload["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = "desconocido"
    r = client.post("/webhook/whatsapp", json=payload)
    assert r.status_code == 200 and r.json()["mensajes"] == 1
    assert no_send[-1][0] == "juana"
    assert "Carta hoy" in no_send[-1][2]


def test_takeover_pausa_bot_release_reactiva(owner_headers, no_send):
    wa = wa_id_unico()
    client.post("/webhook/whatsapp", json=wa_payload(wa, "menu"))
    conv = conv_de("faro", wa, owner_headers)
    assert client.post(f"/api/conversations/{conv['id']}/read",
                      headers=owner_headers).json()["unread"] == 0

    # takeover: el operador toma el control
    d = client.post(f"/api/conversations/{conv['id']}/takeover",
                    headers=owner_headers).json()
    assert d["estado"] == "humano" and d["assigned_to"] is not None
    client.post("/webhook/whatsapp", json=wa_payload(wa, "hola"))
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    # NADA de bot en handoff, y el mensaje no cuenta como no leído
    assert [m["role"] for m in msgs] == ["cliente", "bot", "cliente"]
    assert conv_de("faro", wa, owner_headers)["unread"] == 0

    # release: el bot vuelve
    d = client.post(f"/api/conversations/{conv['id']}/release",
                    headers=owner_headers).json()
    assert d["estado"] == "bot" and d["assigned_to"] is None
    client.post("/webhook/whatsapp", json=wa_payload(wa, "hola"))
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs][-1] == "bot"


def test_resuelta_se_reabre_con_mensaje_nuevo(owner_headers, no_send):
    wa = wa_id_unico()
    client.post("/webhook/whatsapp", json=wa_payload(wa, "menu"))
    conv = conv_de("faro", wa, owner_headers)
    d = client.post(f"/api/conversations/{conv['id']}/resolve",
                    headers=owner_headers).json()
    assert d["estado"] == "resuelta"
    client.post("/webhook/whatsapp", json=wa_payload(wa, "hola"))
    conv = conv_de("faro", wa, owner_headers)
    assert conv["estado"] == "bot"  # reabierta
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot", "cliente", "bot"]


def test_mensaje_humano_se_envia_y_nota_no(owner_headers, no_send):
    wa = wa_id_unico()
    client.post("/webhook/whatsapp", json=wa_payload(wa, "menu"))
    conv = conv_de("faro", wa, owner_headers)
    r = client.post(f"/api/conversations/{conv['id']}/messages",
                    headers=owner_headers, json={"body": "Sí, ya tomamos tu pedido"})
    assert r.status_code == 200 and r.json()["role"] == "humano"
    # el último send es el del humano; el primero fue el bot del "menu"
    assert no_send[-1] == ("faro", wa, "Sí, ya tomamos tu pedido")
    # nota interna: queda en el hilo, NUNCA por WhatsApp
    no_send.clear()
    r = client.post(f"/api/conversations/{conv['id']}/note",
                    headers=owner_headers, json={"texto": "cliente molesto, cuidado"})
    assert r.status_code == 200
    assert r.json()["body"].startswith("[nota interna] cliente molesto")
    assert no_send == []


def test_ws_emite_conversation_y_message_events(owner_headers, no_send):
    headers, token = registrar_y_loguear()
    wa = wa_id_unico()
    with client.websocket_connect(f"/ws/orders?token={token}") as ws:
        client.post("/webhook/whatsapp", json=wa_payload(wa, "menu"))
        ev = ws.receive_json()
        assert ev["event"] == "conversation.updated"
        assert ev["conversation"]["wa_id"] == wa
        assert ev["conversation"]["canal"] == "whatsapp"
        ev = ws.receive_json()
        assert ev["event"] == "message.created" and ev["message"]["role"] == "cliente"
        ev = ws.receive_json()
        assert ev["event"] == "message.created" and ev["message"]["role"] == "bot"
        assert "Carta hoy" in ev["message"]["body"]


# ── Graph API: setup, status, register-webhook, send (monkeypatcheado) ──

def test_setup_guarda_canal_y_send_lo_usa(owner_headers, monkeypatch):
    r = client.post("/api/whatsapp/setup", headers=owner_headers,
                    json={"tenant": "faro", "phone_number_id": "PNID-TEST",
                          "token": "TOK-TEST"})
    assert r.status_code == 200
    d = r.json()
    assert d["estado"] == "conectado" and d["phone_number_id"] == "PNID-TEST"
    assert "TOK-TEST" not in json.dumps(d)  # el token nunca viaja en respuestas
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path, data=data, token=token)
        return {"messaging_product": "whatsapp", "messages": [{"id": "wamid.9"}]}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    resp = whatsapp.send_whatsapp("faro", "51991234567", "prueba canal")
    assert resp["messages"][0]["id"] == "wamid.9"
    assert captura["path"] == "PNID-TEST/messages"  # canal guardado, no env
    assert captura["token"] == "TOK-TEST"
    assert captura["data"]["messaging_product"] == "whatsapp"
    assert captura["data"]["text"]["body"] == "prueba canal"


def test_status_sin_secrets_y_datos_wizard(owner_headers, monkeypatch):
    monkeypatch.setattr(whatsapp, "graph_request", lambda *a, **k: {
        "data": [{"object": "whatsapp",
                  "callback_url": "https://tunel.example/webhook/whatsapp",
                  "fields": ["messages"]}]})
    r = client.get("/api/whatsapp/status?tenant=faro", headers=owner_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["webhook_url_registrada"] == "https://tunel.example/webhook/whatsapp"
    assert d["verify_token"] == os.environ.get("META_VERIFY_TOKEN", "")
    assert d["waba_id"] == os.environ.get("META_WABA_ID", "")
    assert d["app_id"] == os.environ.get("META_APP_ID", "")
    assert os.environ.get("META_APP_SECRET", "x") not in json.dumps(d)
    assert os.environ.get("META_PERMANENT_TOKEN", "x") not in json.dumps(d)
    # status exige Bearer (lleva datos del wizard)
    assert client.get("/api/whatsapp/status?tenant=faro").status_code == 401


def test_register_webhook_llama_graph_con_forma_meta(owner_headers, monkeypatch):
    captura = {}

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        captura.update(path=path, data=data, method=method, token=token)
        return {"success": True}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/register-webhook", headers=owner_headers,
                   json={"tenant": "faro",
                         "callback_url": "https://tunel.example/webhook/whatsapp"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.json()["ya_registrada"] is False
    app_id, secret = os.environ["META_APP_ID"], os.environ["META_APP_SECRET"]
    assert captura["path"] == f"{app_id}/subscriptions"
    assert captura["method"] == "POST"
    assert captura["token"] == f"{app_id}|{secret}"
    assert captura["data"] == {
        "object": "whatsapp",
        "callback_url": "https://tunel.example/webhook/whatsapp",
        "verify_token": os.environ["META_VERIFY_TOKEN"],
        "fields": "messages"}


def test_register_webhook_ya_registrada_es_benigna(owner_headers, monkeypatch):
    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        raise whatsapp.GraphError(
            400, {"error": {"message": "(#6203) Subscription callback "
                                       "URL ... already exists"}})

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/register-webhook", headers=owner_headers,
                    json={"tenant": "faro",
                          "callback_url": "https://tunel.example/webhook/whatsapp"})
    assert r.status_code == 200
    assert r.json()["ok"] is True and r.json()["ya_registrada"] is True


def test_send_whatsapp_reintenta_5xx_no_4xx(monkeypatch):
    estado = {"n": 0}

    def flaky(path, data=None, method="POST", token="", timeout=30):
        estado["n"] += 1
        if estado["n"] == 1:
            raise whatsapp.GraphError(500, {"error": {"message": "boom"}})
        return {"messaging_product": "whatsapp", "messages": [{"id": "wamid.ok"}]}

    monkeypatch.setattr(whatsapp, "graph_request", flaky)
    resp = whatsapp.send_whatsapp("faro", "51991234567", "hola")
    assert estado["n"] == 2 and resp["messages"][0]["id"] == "wamid.ok"  # 1 retry

    def permanente(path, data=None, method="POST", token="", timeout=30):
        estado["n"] += 1
        raise whatsapp.GraphError(400, {"error": {"message": "solicitud mala"}})

    monkeypatch.setattr(whatsapp, "graph_request", permanente)
    with pytest.raises(whatsapp.GraphError):
        whatsapp.send_whatsapp("faro", "51991234567", "hola")
    assert estado["n"] == 3  # 4xx: no se reintenta


def test_register_webhook_rechaza_sin_ser_owner(staff_headers):
    r = client.post("/api/whatsapp/register-webhook", headers=staff_headers,
                    json={"tenant": "faro", "callback_url": "https://x.example"})
    assert r.status_code == 403
    assert client.get("/api/whatsapp/status?tenant=faro").status_code == 401


# ── integración REAL con Meta (gated): envía WhatsApp de verdad ──

@pytest.mark.skipif(not os.environ.get("RUN_META_TESTS"),
                    reason="envía un WhatsApp real: requiere credenciales Meta "
                           "del .env y WHATSAPP_QA_RECIPIENT")
def test_meta_send_whatsapp_real():
    """Envía un mensaje REAL por Graph API al QA recipient del .env."""
    from sqlmodel import Session, select

    from app.db import engine
    from app.models import WhatsAppChannel

    to = os.environ["WHATSAPP_QA_RECIPIENT"]
    # tests previos de setup pudieron guardar un canal dummy para faro:
    # bórralo para que el envío use las credenciales REALES del .env
    with Session(engine) as session:
        for ch in session.exec(select(WhatsAppChannel).where(
                WhatsAppChannel.tenant_id == "faro")).all():
            session.delete(ch)
        session.commit()
    resp = whatsapp.send_whatsapp("faro", to, "Hola! Prueba del SaaS Recepcionista 🎉")
    # urllib lanza ante non-200: llegar aquí = Graph respondió 200
    assert resp.get("messaging_product") == "whatsapp"
    assert resp["messages"][0]["id"].startswith("wamid.")


def test_conectar_ejecuta_la_secuencia_completa(owner_headers, monkeypatch):
    """El botón de un clic: suscripción whatsapp_business_account + campo
    messages, limpieza de la vieja, subscribed_apps y verificación final."""
    llamadas = []

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        llamadas.append((method, path, data, token))
        if method == "GET" and path.endswith("subscriptions"):
            return {"data": [{"object": "whatsapp_business_account",
                              "callback_url": "https://wa.example/webhook/whatsapp",
                              "active": True,
                              "fields": [{"name": "messages", "version": "v26.0"}]}]}
        return {"success": True}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/conectar", headers=owner_headers,
                    json={"tenant": "faro",
                          "callback_url": "https://wa.example/webhook/whatsapp"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    pasos = {p["paso"]: p["ok"] for p in d["pasos"]}
    assert pasos == {"canal": True, "suscripcion": True, "limpieza": True,
                     "subscribed_apps": True, "verificacion": True}
    metodos = [(m, p) for m, p, _, _ in llamadas]
    app_id = os.environ["META_APP_ID"]
    waba = os.environ["META_WABA_ID"]
    assert ("POST", f"{app_id}/subscriptions") in metodos
    assert ("DELETE", f"{app_id}/subscriptions?object=whatsapp") in metodos
    assert ("POST", f"{waba}/subscribed_apps") in metodos
    sus = next(d for m, p, d, _ in llamadas
               if m == "POST" and p == f"{app_id}/subscriptions")
    assert sus["object"] == "whatsapp_business_account"  # NO el viejo "whatsapp"
    assert sus["fields"] == "messages"
    assert d["webhook_url_registrada"] == "https://wa.example/webhook/whatsapp"


def test_conectar_sin_callback_url_usa_hostname_del_env(owner_headers, monkeypatch):
    monkeypatch.setenv("CF_TUNNEL_HOSTNAME", "wa.dylmow.tech")

    def fake_graph(path, data=None, method="POST", token="", timeout=30):
        if method == "GET" and path.endswith("subscriptions"):
            return {"data": []}
        return {"success": True}

    monkeypatch.setattr(whatsapp, "graph_request", fake_graph)
    r = client.post("/api/whatsapp/conectar", headers=owner_headers,
                    json={"tenant": "faro"})
    assert r.status_code == 200
    r2 = client.post("/api/whatsapp/conectar", headers=owner_headers,
                     json={"tenant": "faro"})
    assert r2.status_code == 200  # idempotente
    d = r.json()
    # verificacion en False porque el mock reporta data vacia, pero el paso suscripcion lleva el callback del env
    paso_sus = next(p for p in d["pasos"] if p["paso"] == "suscripcion")
    assert "wa.dylmow.tech/webhook/whatsapp" in paso_sus["detalle"]


def test_conectar_requiere_owner(owner_headers):
    # staff (cocina@demo.pe) no puede conectar el canal del local
    r = client.post("/api/auth/login",
                    json={"email": "cocina@demo.pe", "password": "demo1234"})
    staff_headers = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = client.post("/api/whatsapp/conectar", headers=staff_headers,
                    json={"tenant": "faro"})
    assert r.status_code == 403
