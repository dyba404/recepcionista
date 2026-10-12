"""Inbox + canal demo: el simulador legacy (/api/chat) alimenta las mismas
conversaciones cuando el módulo inbox está ON (modulos-mvp, Fase A)."""
import uuid

from conftest import client, registrar_y_loguear


def demo_customer() -> str:
    return f"Demo-{uuid.uuid4().hex[:8]}"


def chat(tenant, customer, message, cart=None):
    return client.post("/api/chat", json={"tenant": tenant, "customer": customer,
                                          "message": message, "cart": cart or []})


def conv_de(tenant: str, wa_id: str, headers) -> dict:
    convs = client.get(f"/api/conversations?tenant={tenant}", headers=headers).json()
    return next(c for c in convs if c["wa_id"] == wa_id)


def test_chat_legacy_genera_conversacion_demo(owner_headers):
    wa = demo_customer()
    r = chat("faro", wa, "menu")
    assert r.status_code == 200 and "Carta hoy" in r.json()["reply"]
    conv = conv_de("faro", wa, owner_headers)
    assert conv["canal"] == "demo" and conv["estado"] == "bot"
    assert conv["cliente"] == wa and conv["unread"] == 1
    assert "Carta hoy" in conv["last_body"]  # último = respuesta del bot
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [(m["role"], "menu" in m["body"]) for m in msgs] == [("cliente", True),
                                                                ("bot", False)]
    # el carrito del simulador sigue viajando en la respuesta (no persiste por
    # conversación en esta fase, pero el endpoint lo devuelve igual que antes)
    r = chat("faro", wa, "quiero 2 ceviche")
    assert {c["id"]: c["cant"] for c in r.json()["cart"]} == {"f1": 2.0}


def test_unread_acumula_y_read_a_cero(owner_headers):
    wa = demo_customer()
    chat("faro", wa, "menu")
    chat("faro", wa, "y tienen postres?")
    conv = conv_de("faro", wa, owner_headers)
    assert conv["unread"] == 2  # solo mensajes del cliente suman
    d = client.post(f"/api/conversations/{conv['id']}/read",
                    headers=owner_headers).json()
    assert d["unread"] == 0
    assert conv_de("faro", wa, owner_headers)["unread"] == 0


def test_takeover_demo_pausa_bot_y_reply_de_handoff(owner_headers):
    wa = demo_customer()
    chat("faro", wa, "menu")
    conv = conv_de("faro", wa, owner_headers)
    d = client.post(f"/api/conversations/{conv['id']}/takeover",
                    headers=owner_headers).json()
    assert d["estado"] == "humano" and d["assigned_nombre"] == "Owner Test"
    client.post(f"/api/conversations/{conv['id']}/read", headers=owner_headers)
    # con un humano atendiendo, /api/chat no genera respuesta del bot
    r = chat("faro", wa, "hola")
    assert r.status_code == 200
    assert "persona del equipo" in r.json()["reply"]
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot", "cliente"]
    assert conv_de("faro", wa, owner_headers)["unread"] == 0  # handoff: sin unread


def test_release_y_resolve_en_demo(owner_headers):
    wa = demo_customer()
    chat("faro", wa, "menu")
    conv = conv_de("faro", wa, owner_headers)
    client.post(f"/api/conversations/{conv['id']}/takeover", headers=owner_headers)
    d = client.post(f"/api/conversations/{conv['id']}/release",
                    headers=owner_headers).json()
    assert d["estado"] == "bot" and d["assigned_to"] is None
    chat("faro", wa, "hola")
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert msgs[-1]["role"] == "bot"  # release reactiva al bot
    d = client.post(f"/api/conversations/{conv['id']}/resolve",
                    headers=owner_headers).json()
    assert d["estado"] == "resuelta"
    # un mensaje nuevo reabre la conversación a "bot"
    chat("faro", wa, "hola")
    assert conv_de("faro", wa, owner_headers)["estado"] == "bot"


def test_filtros_estado_solo_mias_y_assign(owner_headers, staff_headers):
    wa_a, wa_b = demo_customer(), demo_customer()
    chat("faro", wa_a, "menu")
    chat("faro", wa_b, "menu")
    conv_a = conv_de("faro", wa_a, owner_headers)
    staff_id = client.get("/api/auth/me", headers=staff_headers).json()["id"]
    # asignar la A a cocina (staff) y tomar la B como owner
    r = client.post(f"/api/conversations/{conv_a['id']}/assign",
                    headers=owner_headers, json={"user_id": staff_id})
    assert r.status_code == 200 and r.json()["assigned_nombre"] == "Cocina Faro"
    conv_b = conv_de("faro", wa_b, owner_headers)
    client.post(f"/api/conversations/{conv_b['id']}/takeover", headers=owner_headers)
    # solo_mias (owner): solo la B
    r = client.get("/api/conversations?tenant=faro&solo_mias=true",
                   headers=owner_headers)
    assert [c["wa_id"] for c in r.json()] == [wa_b]
    # user_id (staff): solo la A
    r = client.get(f"/api/conversations?tenant=faro&user_id={staff_id}",
                   headers=owner_headers)
    assert [c["wa_id"] for c in r.json()] == [wa_a]
    # filtro por estado: ambas en humano tras takeover... la A sigue "bot"
    r = client.get("/api/conversations?tenant=faro&estado=humano",
                   headers=owner_headers)
    assert wa_b in [c["wa_id"] for c in r.json()]
    assert wa_a not in [c["wa_id"] for c in r.json()]
    # asignar a un user inexistente
    r = client.post(f"/api/conversations/{conv_a['id']}/assign",
                    headers=owner_headers, json={"user_id": 999999})
    assert r.status_code == 404


def test_mensaje_humano_en_demo_solo_guarda(owner_headers):
    wa = demo_customer()
    chat("faro", wa, "menu")
    conv = conv_de("faro", wa, owner_headers)
    r = client.post(f"/api/conversations/{conv['id']}/messages",
                    headers=owner_headers, json={"body": "Ya anotamos tu pedido"})
    assert r.status_code == 200 and r.json()["role"] == "humano"
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert msgs[-1]["body"] == "Ya anotamos tu pedido"
    # conversación demo: no hay envío (no se puede probar el envío real aquí,
    # el canal whatsapp lo cubre test_whatsapp.py)


def test_canned_crud(owner_headers):
    shortcut = f"/apagar-{uuid.uuid4().hex[:6]}"
    r = client.post("/api/canned?tenant=faro", headers=owner_headers,
                   json={"shortcut": shortcut, "texto": "Un momento, ya te confirmo."})
    assert r.status_code == 201
    canned = r.json()
    assert canned["shortcut"] == shortcut
    # listar
    r = client.get("/api/canned?tenant=faro", headers=owner_headers)
    assert shortcut in [c["shortcut"] for c in r.json()]
    # borrar y verificar
    r = client.delete(f"/api/canned?tenant=faro&id={canned['id']}",
                      headers=owner_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    r = client.get("/api/canned?tenant=faro", headers=owner_headers)
    assert shortcut not in [c["shortcut"] for c in r.json()]
    # DELETE del mismo id otra vez: 404
    assert client.delete(f"/api/canned?tenant=faro&id={canned['id']}",
                         headers=owner_headers).status_code == 404
    # canned de otro tenant intocable por la puerta de juana
    r = client.post("/api/canned?tenant=juana", headers=owner_headers,
                    json={"shortcut": "/x", "texto": "texto juana"})
    assert r.status_code == 201
    assert client.delete(f"/api/canned?tenant=faro&id={r.json()['id']}",
                         headers=owner_headers).status_code == 404


def test_conversations_requieren_auth(owner_headers):
    assert client.get("/api/conversations?tenant=faro").status_code == 401
    assert client.get("/api/canned?tenant=faro").status_code == 401
    r = client.get("/api/conversations?tenant=faro", headers=owner_headers)
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_handoff_flujo_completo_asignacion_cruzada(owner_headers):
    """takeover de un staff: cualquier usuario autenticado atiende el inbox."""
    wa = demo_customer()
    chat("faro", wa, "menu")
    conv = conv_de("faro", wa, owner_headers)
    staff_headers = registrar_y_loguear(nombre="Staff Atiende", tenant_id="faro")[0]
    d = client.post(f"/api/conversations/{conv['id']}/takeover",
                    headers=staff_headers).json()
    assert d["estado"] == "humano" and d["assigned_nombre"] == "Staff Atiende"
    assert conv_de("faro", wa, owner_headers)["assigned_nombre"] == "Staff Atiende"
