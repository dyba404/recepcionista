"""Batería E2E de la API (lo que antes se probaba a mano con curl).

Los mensajes usados son deterministas (NLU): no invocan el LLM. El caso long-tail
real de opencode va marcado como integración y se corre solo con RUN_LLM_TESTS=1.
"""
import os
import uuid
from urllib.parse import quote

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app import store
from app.main import app

client = TestClient(app)


def patch_estado(oid, estado, headers=None):
    # los ids llevan "#": sin URL-encodear httpx lo trata como fragmento
    return client.patch(f"/api/orders/{quote(oid)}", json={"estado": estado},
                        headers=headers)


@pytest.fixture(autouse=True)
def _demo_limpia():
    store.reset_demo()
    yield
    store.reset_demo()


def registrar_y_loguear(nombre="Owner Test"):
    """Helper de auth: registra un usuario único, loguea y devuelve (headers, token)."""
    email = f"owner-{uuid.uuid4().hex[:8]}@test.pe"
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "secreto123", "nombre": nombre})
    assert r.status_code == 201
    r = client.post("/api/auth/login", json={"email": email, "password": "secreto123"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, token


@pytest.fixture()
def auth_headers():
    headers, _ = registrar_y_loguear()
    return headers


def chat(tenant, customer, message, cart=None):
    return client.post("/api/chat", json={
        "tenant": tenant, "customer": customer,
        "message": message, "cart": cart or []})


# ── carta / fotos ──

def test_tenants_ok():
    r = client.get("/api/tenants")
    assert r.status_code == 200
    assert {t["id"] for t in r.json()} == {"faro", "brasa", "juana"}


def test_menu_incluye_foto():
    r = client.get("/api/menu?tenant=faro")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["foto"].endswith(f"/static/img/platos/{items[0]['id']}.jpg")


def test_menu_toggle_valida_precio(auth_headers):
    assert client.post("/api/menu/toggle", headers=auth_headers,
                       json={"tenant": "faro", "id": "f1", "precio": "abc"}).status_code == 400
    assert client.post("/api/menu/toggle", headers=auth_headers,
                       json={"tenant": "faro", "id": "f1", "precio": -5}).status_code == 400
    ok = client.post("/api/menu/toggle", headers=auth_headers,
                     json={"tenant": "faro", "id": "f1", "precio": 33.5})
    assert ok.status_code == 200 and ok.json()["precio"] == 33.5


# ── atencion-chat: NLU determinista ──

def test_carta_numerada_con_formato():
    r = chat("faro", "T1", "menu")
    assert r.status_code == 200
    body = r.json()["reply"]
    assert "Carta hoy" in body and "1. *Ceviche clásico*" in body


def test_saludo_casual_no_cae_en_fotos():
    # regresión: "como es" era subcadena de "como estas" y mandaba a la rama de fotos
    r = chat("faro", "T1", "hola como estas")
    body = r.json()["reply"]
    assert "Carta hoy" in body
    assert "Todavía no mando" not in body


def test_foto_de_plato_viaja_en_respuesta():
    r = chat("faro", "T2", "tienes foto del ceviche?")
    d = r.json()
    assert d["foto"].endswith("/static/img/platos/f1.jpg")
    assert "Ceviche" in d["reply"]


def test_pedido_multiitem():
    r = chat("faro", "T3", "quiero 2 ceviche + 1 inca")
    cart = {c["id"]: c["cant"] for c in r.json()["cart"]}
    assert cart == {"f1": 2.0, "f5": 1.0}


def test_pedido_natural_sin_cifra_no_pierde_items():
    # regresión: "quiero un ceviche y una chicha" perdía el ceviche
    r = chat("faro", "T3", "quiero un ceviche y una chicha")
    cart = {c["id"]: c["cant"] for c in r.json()["cart"]}
    assert cart == {"f1": 1.0, "f4": 1.0}


def test_verbo_sin_cantidad_agrega_uno():
    r = chat("faro", "T3", "quiero ceviche")
    assert r.json()["cart"][0]["id"] == "f1"


def test_medio_pollo_mapea_a_item_porcion():
    r = chat("brasa", "T4", "quiero medio pollo")
    assert r.json()["cart"][0]["id"] == "b2"


def test_confirmar_pide_direccion_y_la_guarda():
    cart = [{"id": "f1", "cant": 2}, {"id": "f5", "cant": 1}]
    r1 = chat("faro", "T5", "confirmar", cart)
    assert "dirección" in r1.json()["reply"].lower()
    r2 = chat("faro", "T5", "Av Encalada 789", cart)
    d = r2.json()
    assert d["next"] == "pago" and d["direccion"] == "Av Encalada 789"


def test_demora_sin_pedido_no_es_tracking():
    # regresión: "cuanto demora?" respondía "no encuentro tu pedido"
    r = chat("faro", "T6", "cuanto demora?")
    assert "30-40 min" in r.json()["reply"]
    assert "No encuentro" not in r.json()["reply"]


def test_llegan_es_cobertura_no_tracking():
    r = chat("faro", "T6", "a donde llegan?")
    assert "delivery" in r.json()["reply"].lower()


def test_tracking_con_pedido_real():
    r = chat("faro", "María", "donde esta mi pedido?")
    body = r.json()["reply"]
    assert "#101" in body and "pendiente" in body


# ── pagos y anti-fraude ──

def _crear_pedido(tenant="faro", cliente="Pay", items=None, direccion="Calle Test 1"):
    r = client.post("/api/orders", json={
        "tenant": tenant, "cliente": cliente,
        "items": items or [{"id": "f1", "cant": 1}], "direccion": direccion})
    assert r.status_code == 200
    return r.json()


def test_anti_fraude_patch_sin_pago_rechazado(auth_headers):
    o = _crear_pedido()
    r = patch_estado(o["id"], "cocina", auth_headers)
    assert r.status_code == 400


def test_culqi_link_webhook_y_avance(auth_headers):
    o = _crear_pedido()
    link = client.post("/api/payments/culqi/link",
                       json={"tenant": "faro", "order_id": o["id"]}).json()
    assert link["reference_id"]
    wh = client.post("/api/payments/culqi/webhook",
                     json={"reference_id": link["reference_id"]}).json()
    assert wh["ok"] and wh["order"]["pago"] == "pagado_culqi"
    r = patch_estado(o["id"], "cocina", auth_headers)
    assert r.status_code == 200 and r.json()["estado"] == "cocina"


def test_yape_falso_queda_pendiente_y_bloquea(auth_headers):
    o = _crear_pedido(tenant="brasa", items=[{"id": "b3", "cant": 1}])
    r = client.post("/api/payments/yape",
                    json={"order_id": o["id"], "monto_foto": o["total"] - 10})
    d = r.json()
    assert d["ok"] is False and d["order"]["pago"] == "pendiente_verificar"
    assert patch_estado(o["id"], "cocina", auth_headers).status_code == 400


def test_yape_exacto_paga():
    o = _crear_pedido()
    r = client.post("/api/payments/yape",
                    json={"order_id": o["id"], "monto_foto": o["total"]})
    assert r.json()["ok"] is True


def test_charge_real_sin_llaves_orienta_al_simulado():
    o = _crear_pedido()
    r = client.post("/api/payments/culqi/charge",
                    json={"order_id": o["id"], "token": "tkn_test"})
    assert r.status_code == 400
    assert "CULQI_SECRET_KEY" in r.json()["detail"]


def test_payments_config_expone_yape_y_modo_culqi():
    r = client.get("/api/payments/config?tenant=faro")
    d = r.json()
    assert d["yape_qr"] == "YA-FARO-123"
    assert "culqi_pk" in d


# ── auth (ADR 0002) ──

def test_login_seed_demo_ok():
    r = client.post("/api/auth/login",
                    json={"email": "admin@demo.pe", "password": "demo1234"})
    assert r.status_code == 200
    d = r.json()
    assert d["token_type"] == "bearer" and d["access_token"]
    assert d["user"]["email"] == "admin@demo.pe" and d["user"]["rol"] == "owner"
    assert "password_hash" not in d["user"]


def test_login_password_mala_401():
    r = client.post("/api/auth/login",
                    json={"email": "admin@demo.pe", "password": "equivocada"})
    assert r.status_code == 401


def test_me_con_token_y_sin_token():
    headers, token = registrar_y_loguear()
    r = client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
    assert "password_hash" not in r.json()
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").json()["detail"] == "No autenticado"
    # misma forma, firma distinta: 401
    falsificado = {"Authorization": f"Bearer {token}x"}
    assert client.get("/api/auth/me", headers=falsificado).status_code == 401


def test_register_duplicado_409():
    payload = {"email": f"dup-{uuid.uuid4().hex[:8]}@test.pe",
               "password": "secreto123", "nombre": "Dup"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_register_password_corta_422():
    r = client.post("/api/auth/register",
                    json={"email": f"corta-{uuid.uuid4().hex[:8]}@test.pe",
                          "password": "corta12", "nombre": "Corta"})  # 7 caracteres
    assert r.status_code == 422


# ── guardias de dueño ──

def test_guardias_sin_token_401():
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/orders").json()["detail"] == "No autenticado"
    assert patch_estado("#101", "cocina").status_code == 401
    assert client.post("/api/menu/toggle",
                       json={"tenant": "faro", "id": "f1", "disponible": True}).status_code == 401
    assert client.post("/api/demo/reset").status_code == 401


def test_guardias_con_token_pasan(auth_headers):
    assert client.get("/api/orders", headers=auth_headers).status_code == 200


# ── websocket realtime ──

def test_ws_orders_recibe_order_created():
    headers, token = registrar_y_loguear()
    with client.websocket_connect(f"/ws/orders?token={token}") as ws:
        o = _crear_pedido()
        msg = ws.receive_json()
        assert msg["event"] == "order.created"
        assert msg["order"]["id"] == o["id"]
        assert msg["order"]["cliente"] == "Pay"


def test_ws_token_invalido_cierra_4401():
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/orders?token=no-es-un-jwt") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


# ── infraestructura ──

def test_vistas_legacy_siguen_servidas():
    for ruta, marca in [("/", "Recepcionista"), ("/chat", "Chat"),
                        ("/panel", "Panel"), ("/cocina", "Cocina"), ("/menu", "Carta")]:
        r = client.get(ruta)
        assert r.status_code == 200
        assert marca in r.text


def test_foto_estatica_existe():
    r = client.get("/static/img/platos/f1.jpg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/jpeg")


@pytest.mark.skipif(not os.environ.get("RUN_LLM_TESTS"),
                    reason="integración lenta: llama a opencode (muse-spark) de verdad")
def test_llm_long_tail_real():
    r = chat("faro", "LLM1", "tengo una reunion de 10 personas, que me recomiendas?")
    d = r.json()
    assert not d["reply"].startswith("No me quedó claro")
