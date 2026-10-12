"""Tests del change carta-inventario-bot (contrato completo).

A. Stock: 409 con TODOS los faltantes ANTES de crear, decremento persistido
   (write-through), no-decremento si falla, stock==0 == disponible=False en
   NLU y carta, PATCH items con sentinel de stock (ausente vs null).
B. KB: CRUD + intents horario/ubicación responden SOLO el contenido de la
   entrada activa + honesta sin KB (nunca LLM) + activo=false fuera del
   prompt + los intents no secuestran el flujo de pedido/dirección.
C. BotConfig: PUT cambia saludo/tono/instrucciones y el bot LOS USA
   (menu_text saludo, context_block tono/extras/nombre, identity), 422 >800,
   seed por tenant + idempotencia del re-hidratar.
"""
import pytest
from conftest import client, registrar_y_loguear
from sqlmodel import Session, select

from app import bot, brain, data, kb, logic, seed, store
from app.db import engine
from app.models import BotConfig, KnowledgeEntry, MenuItem

HONESTA = "No tengo ese dato cargado, escríbele al local"


@pytest.fixture(autouse=True)
def _mundo_restaurado():
    """Cada test nace y muere con el demo de fábrica: pedidos/carta a seed
    (store.reset_demo) y KB+BotConfig re-sembradas de cero (borrar todo y
    seed.run, que es idempotente) — los PUT/PATCH/DELETE de esta suite no
    se filtran al resto de la corrida."""
    store.reset_demo()
    yield
    store.reset_demo()
    with Session(engine) as session:
        for row in session.exec(select(BotConfig)).all():
            session.delete(row)
        for row in session.exec(select(KnowledgeEntry)).all():
            session.delete(row)
        session.commit()
    seed.run()


def chat(tenant, customer, message, cart=None):
    return client.post("/api/chat", json={
        "tenant": tenant, "customer": customer,
        "message": message, "cart": cart or []})


def patch_item(payload, headers):
    return client.patch("/api/menu/items", json=payload, headers=headers)


def _item(tenant, iid):
    return next(x for x in client.get(f"/api/menu?tenant={tenant}").json()["items"]
                if x["id"] == iid)


def crear_pedido(items, tenant="faro", cliente="Stock"):
    return client.post("/api/orders", json={
        "tenant": tenant, "cliente": cliente, "items": items,
        "direccion": "Calle Test 1"})


# ══ A. Carta CRUD + inventario (stock) ══

def test_menu_devuelve_stock_del_seed():
    assert _item("faro", "f1")["stock"] == 8
    assert _item("faro", "f6")["stock"] == 0
    assert _item("faro", "f2")["stock"] is None  # sin límite


def test_pedido_con_stock_insuficiente_409_con_todos_los_faltantes(owner_headers):
    patch_item({"tenant": "faro", "id": "f2", "stock": 1}, owner_headers)
    patch_item({"tenant": "faro", "id": "f3", "stock": 0}, owner_headers)
    r = crear_pedido([{"id": "f2", "cant": 5}, {"id": "f3", "cant": 1},
                      {"id": "f1", "cant": 2}])
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "Stock insuficiente" in detail
    assert "Lomo saltado agotado (quedan 1)" in detail
    assert "Arroz con mariscos agotado (quedan 0)" in detail
    assert "Ceviche" not in detail  # f1 alcanzaba: no es faltante


def test_409_no_crea_pedido_ni_decrementa(owner_headers):
    patch_item({"tenant": "faro", "id": "f2", "stock": 1}, owner_headers)
    antes = len(client.get("/api/orders?tenant=faro", headers=owner_headers).json())
    r = crear_pedido([{"id": "f2", "cant": 3}])
    assert r.status_code == 409
    assert len(client.get("/api/orders?tenant=faro", headers=owner_headers).json()) == antes
    assert _item("faro", "f2")["stock"] == 1  # nada se movió


def test_pedido_decrementa_stock_y_persiste(owner_headers):
    patch_item({"tenant": "faro", "id": "f5", "stock": 3}, owner_headers)
    r = crear_pedido([{"id": "f5", "cant": 2}, {"id": "f1", "cant": 1}])
    assert r.status_code == 200
    assert _item("faro", "f5")["stock"] == 1
    assert _item("faro", "f1")["stock"] == 7
    with Session(engine) as session:  # write-through: la fila dice lo mismo
        assert session.get(MenuItem, "f5").stock == 1
        assert session.get(MenuItem, "f1").stock == 7


def test_lineas_repetidas_del_mismo_plato_acumulan(owner_headers):
    patch_item({"tenant": "faro", "id": "f5", "stock": 3}, owner_headers)
    r = crear_pedido([{"id": "f5", "cant": 2}, {"id": "f5", "cant": 2}])
    assert r.status_code == 409  # 2+2 > 3, aunque cada línea pase sola
    # "quedan N" es el stock RESTANTE tras las líneas anteriores del mismo
    # pedido (3 - 2 = 1): el consumo acumula antes de validar
    assert "Inca Kola 500ml agotado (quedan 1)" in r.json()["detail"]


def test_stock_nulo_es_ilimitado_y_item_desconocido_no_falla(owner_headers):
    r = crear_pedido([{"id": "f2", "cant": 50}, {"id": "zzz", "cant": 2}])
    assert r.status_code == 200  # f2 sin stock y "zzz" ignora el control
    assert _item("faro", "f2")["stock"] is None


def test_stock_cero_409_igual_que_disponible_false(owner_headers):
    # disponible=True pero stock 0: el pedido NO pasa (contrato)
    patch_item({"tenant": "faro", "id": "f6", "disponible": True}, owner_headers)
    r = crear_pedido([{"id": "f6", "cant": 1}])
    assert r.status_code == 409
    assert "Tiradito nikkei agotado (quedan 0)" in r.json()["detail"]


def test_reset_demo_restaura_el_stock_del_seed(owner_headers):
    patch_item({"tenant": "faro", "id": "f1", "stock": 1}, owner_headers)
    store.reset_demo()
    assert _item("faro", "f1")["stock"] == 8
    assert _item("faro", "f6")["stock"] == 0


def test_patch_items_edita_todo_y_persiste(owner_headers):
    r = patch_item({"tenant": "faro", "id": "f1", "nombre": "Ceviche del jefe",
                    "desc": "Pesca del día, extra choclo", "precio": 35.5,
                    "cat": "Fondos", "disponible": False, "stock": 4},
                   owner_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["nombre"] == "Ceviche del jefe"
    assert d["desc"] == "Pesca del día, extra choclo"
    assert d["precio"] == 35.5 and d["cat"] == "Fondos"
    assert d["disponible"] is False and d["stock"] == 4
    with Session(engine) as session:
        row = session.get(MenuItem, "f1")
        assert row.nombre == "Ceviche del jefe"
        assert row.desc_ == "Pesca del día, extra choclo"
        assert row.precio == 35.5 and row.cat == "Fondos"
        assert row.disponible is False and row.stock == 4
    assert _item("faro", "f1")["nombre"] == "Ceviche del jefe"  # espejo = fila


def test_patch_stock_null_vuelve_a_ilimitado(owner_headers):
    patch_item({"tenant": "faro", "id": "f1", "stock": 5}, owner_headers)
    r = patch_item({"tenant": "faro", "id": "f1", "stock": None}, owner_headers)
    assert r.status_code == 200 and r.json()["stock"] is None
    assert crear_pedido([{"id": "f1", "cant": 50}]).status_code == 200


def test_patch_sin_clave_stock_no_lo_toca(owner_headers):
    patch_item({"tenant": "faro", "id": "f1", "stock": 3}, owner_headers)
    patch_item({"tenant": "faro", "id": "f1", "nombre": "Ceviche clásico"},
               owner_headers)
    assert _item("faro", "f1")["stock"] == 3


def test_patch_stock_negativo_422_precio_malo_400(owner_headers):
    assert patch_item({"tenant": "faro", "id": "f1", "stock": -1},
                      owner_headers).status_code == 422  # ge=0 del schema
    # precio sigue la convención humana del toggle: 400, no 422
    r = patch_item({"tenant": "faro", "id": "f1", "precio": "abc"}, owner_headers)
    assert r.status_code == 400 and r.json()["detail"].startswith("Precio inválido")
    assert patch_item({"tenant": "faro", "id": "f1", "precio": -5},
                      owner_headers).status_code == 400


def test_patch_items_authz(owner_headers, staff_headers):
    base = {"tenant": "faro", "id": "f1", "stock": 9}
    assert patch_item(base, None).status_code == 401  # sin token
    assert patch_item(base, {}).status_code == 401
    assert patch_item(base, staff_headers).status_code == 403  # staff sin manage_menu
    brasa = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    assert patch_item(base, brasa).status_code == 403  # dueño de OTRO local
    assert patch_item({"tenant": "faro", "id": "zzz", "stock": 1},
                      owner_headers).status_code == 404
    assert patch_item({"tenant": "inexistente", "id": "f1", "stock": 1},
                      owner_headers).status_code == 404


def test_toggle_no_pisa_el_stock(owner_headers):
    patch_item({"tenant": "faro", "id": "f5", "stock": 3}, owner_headers)
    r = client.post("/api/menu/toggle", headers=owner_headers,
                    json={"tenant": "faro", "id": "f5", "precio": 12})
    assert r.status_code == 200
    it = _item("faro", "f5")
    assert it["precio"] == 12 and it["stock"] == 3  # el stock sobrevivió


# ══ A. stock==0 en el NLU: el mismo camino que disponible=False ══

def test_nlu_stock_cero_responde_agotado_con_alternativa(owner_headers):
    patch_item({"tenant": "faro", "id": "f6", "disponible": True}, owner_headers)
    r = chat("faro", "S1", "quiero tiradito")
    body = r.json()["reply"]
    assert "Tiradito nikkei está agotado hoy." in body
    assert "Arroz con mariscos" in body  # alternativa VIVA de Marinos
    assert r.json()["cart"] == []


def test_menu_text_agotados_al_final_fuera_de_numeracion(owner_headers):
    patch_item({"tenant": "faro", "id": "f6", "disponible": True}, owner_headers)
    body = chat("faro", "S2", "menu").json()["reply"]
    assert "5. *Inca Kola 500ml*" in body  # la numeración es la carta viva
    assert "Agotado hoy: *Tiradito nikkei*" in body
    assert "6. *Tiradito" not in body  # jamás numerado
    # el atajo "el N" numeró igual que menu_text (mismo listado)
    assert chat("faro", "S3", "5").json()["reply"].startswith("*Inca Kola 500ml*")


def test_ficha_y_precio_marcan_agotado_por_stock(owner_headers):
    patch_item({"tenant": "faro", "id": "f6", "disponible": True}, owner_headers)
    assert "Agotado hoy." in chat("faro", "S4", "tiradito").json()["reply"]
    assert "Agotado hoy." in chat("faro", "S5", "cuanto esta el tiradito").json()["reply"]


# ══ B. Base de conocimiento ══

def test_kb_seed_faro_tres_entradas(owner_headers):
    r = client.get("/api/kb?tenant=faro", headers=owner_headers)
    assert r.status_code == 200
    entries = {e["tema"]: e for e in r.json()}
    assert set(entries) == {"Horarios", "Ubicación", "Promociones"}
    assert entries["Horarios"]["contenido"] == "Lun a Dom, 12:00 a 22:00"
    assert entries["Ubicación"]["contenido"] == "Av. El Faro 123, Surco — frente al mar"
    assert entries["Promociones"]["contenido"] == "Lleva 2 ceviches y la chicha va por la casa"
    assert all(e["activo"] for e in entries.values())


def test_kb_crud_completo(owner_headers):
    r = client.post("/api/kb", headers=owner_headers,
                    json={"tenant": "faro", "tema": "Wifi", "contenido": "Clave: faro123"})
    assert r.status_code == 201
    eid = r.json()["id"]
    assert r.json()["activo"] is True
    r = client.patch(f"/api/kb/{eid}", headers=owner_headers,
                     json={"tema": "Wifi gratis", "contenido": "Red FARO, clave faro123"})
    assert r.json()["tema"] == "Wifi gratis"
    assert client.patch(f"/api/kb/{eid}", headers=owner_headers,
                        json={"activo": False}).json()["activo"] is False
    assert client.delete(f"/api/kb/{eid}?tenant=faro",
                         headers=owner_headers).json()["ok"] is True
    ids = [e["id"] for e in client.get("/api/kb?tenant=faro",
                                       headers=owner_headers).json()]
    assert eid not in ids


def test_kb_validaciones_y_authz(owner_headers, staff_headers):
    assert client.get("/api/kb?tenant=faro").status_code == 401
    assert client.post("/api/kb", json={"tenant": "faro", "tema": "X",
                                       "contenido": "Y"}).status_code == 401
    assert client.post("/api/kb", headers=staff_headers,
                       json={"tenant": "faro", "tema": "X",
                             "contenido": "Y"}).status_code == 403
    assert client.post("/api/kb", headers=owner_headers,
                       json={"tenant": "faro", "tema": "",
                             "contenido": "Y"}).status_code == 422
    assert client.patch("/api/kb/999999", headers=owner_headers,
                        json={"tema": "X"}).status_code == 404
    brasa = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    faro_id = client.get("/api/kb?tenant=faro", headers=owner_headers).json()[0]["id"]
    assert client.patch(f"/api/kb/{faro_id}", headers=brasa,
                        json={"tema": "X"}).status_code == 403
    # la entrada de otro local no se borra con ?tenant ajeno
    assert client.delete(f"/api/kb/{faro_id}?tenant=brasa",
                         headers=brasa).status_code == 404


def test_intent_horario_responde_solo_el_contenido():
    assert chat("faro", "K1", "a que hora abren?").json()["reply"] == "Lun a Dom, 12:00 a 22:00"
    assert "Lun a Dom" in chat("faro", "K2", "cual es el horario del local?").json()["reply"]
    assert chat("faro", "K3", "atienden los domingos?").json()["reply"] == "Lun a Dom, 12:00 a 22:00"


def test_intent_ubicacion_responde_solo_el_contenido():
    assert chat("faro", "K4", "donde estan ubicados?").json()["reply"] == "Av. El Faro 123, Surco — frente al mar"
    assert chat("faro", "K5", "donde estas ubicado").json()["reply"] == "Av. El Faro 123, Surco — frente al mar"
    assert chat("faro", "K6", "como llegar?").json()["reply"] == "Av. El Faro 123, Surco — frente al mar"


def test_intent_ubicacion_no_se_confunde_con_direccion_del_pedido():
    # con carrito abierto: la pregunta de ubicación es KB, no flujo de dirección
    cart = [{"id": "f1", "cant": 1, "nombre": "Ceviche clásico", "precio": 32.0}]
    d = chat("faro", "K7", "donde estan ubicados", cart=cart).json()
    assert d["reply"] == "Av. El Faro 123, Surco — frente al mar"
    assert d.get("next") != "pago"  # no entró al flujo de cobro
    # y el tracking por "donde" sigue intacto (María tiene el #101 del seed)
    assert "#101" in chat("faro", "María", "donde esta mi pedido?").json()["reply"]


def test_intent_horario_con_kb_del_tema_desactivada(owner_headers):
    entries = client.get("/api/kb?tenant=faro", headers=owner_headers).json()
    eid = next(e["id"] for e in entries if e["tema"] == "Horarios")
    client.patch(f"/api/kb/{eid}", headers=owner_headers, json={"activo": False})
    assert chat("faro", "K8", "a que hora abren?").json()["reply"] == HONESTA


def test_intent_sin_kb_respuesta_honesta_y_nunca_llm():
    # juana no tiene KB: respuesta honesta determinista, sin caer al LLM
    # (que inventaría el horario) — el resultado NO trae "fallback".
    r = chat("juana", "K9", "cual es su horario de atencion")
    d = r.json()
    assert d["reply"] == HONESTA
    assert "fallback" not in d


def test_kb_inactiva_se_excluye_del_prompt(owner_headers):
    entries = client.get("/api/kb?tenant=faro", headers=owner_headers).json()
    eid = next(e["id"] for e in entries if e["tema"] == "Horarios")
    client.patch(f"/api/kb/{eid}", headers=owner_headers, json={"activo": False})
    ctx = brain.context_block("faro")
    assert "Lun a Dom" not in ctx
    assert "frente al mar" in ctx  # las activas siguen


def test_kb_activa_alimenta_context_block():
    ctx = brain.context_block("faro")
    assert "INFORMACION DEL LOCAL" in ctx
    assert "- Horarios: Lun a Dom, 12:00 a 22:00" in ctx
    assert "- Promociones: Lleva 2 ceviches y la chicha va por la casa" in ctx
    assert ctx.index("CARTA") < ctx.index("INFORMACION DEL LOCAL")  # después de CARTA


def test_promo_no_es_intent_el_llm_la_tiene_en_contexto():
    # "promoción" NO dispara NLU determinista: cae al LLM con la KB en contexto
    assert logic.kb_intent(logic.norm("que promociones tienen?")) is None
    ctx = brain.context_block("faro")
    assert "Promociones" in ctx and "chicha va por la casa" in ctx


def test_kb_no_secuestra_el_flujo_de_pedido():
    r = chat("faro", "K10", "quiero 2 ceviche y a que hora abren")
    cart = {c["id"]: c["cant"] for c in r.json()["cart"]}
    assert cart.get("f1") == 2.0  # gana el pedido, como TRACK_W vs ORDER_V


def test_ahora_no_dispara_el_intent_de_horario():
    # regresión del matcher: "hora" va por palabra completa ("ahora" NO)
    r = chat("faro", "K11", "pago ahora")
    assert "Lun a Dom" not in r.json()["reply"]
    assert "Aún no tienes pedido" in r.json()["reply"]


def test_sin_tablas_kb_y_config_el_bot_no_se_rompe(monkeypatch):
    # contrato: brain/logic NO se rompen si la tabla no existe — try/except
    # con defaults. Se simula con un Session que revienta al abrirse.
    def _boom(*a, **k):
        raise RuntimeError("tabla inexistente")
    monkeypatch.setattr(bot, "Session", _boom)
    assert bot.bot_config("faro") == {"nombre_bot": None, "saludo": None,
                                      "tono": "cercano", "instrucciones_extra": ""}
    assert bot.nombre_bot("faro") == "FaroBot"
    monkeypatch.setattr(kb, "Session", _boom)
    assert kb.kb_entries("faro") == []
    assert chat("faro", "K12", "a que hora abren?").json()["reply"] == HONESTA


# ══ C. Bot configurable (Asistente) ══

def test_botconfig_get_devuelve_el_seed(owner_headers):
    r = client.get("/api/botconfig?tenant=faro", headers=owner_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["nombre_bot"] == "FaroBot"
    assert d["saludo"] == data.TENANTS["faro"]["saludo"]
    assert d["tono"] == "cercano"
    assert d["instrucciones_extra"] == ""
    assert d["updated_at"]


def test_seed_botconfig_por_tenant():
    for tid, nombre in [("faro", "FaroBot"), ("brasa", "BrasaBot"),
                        ("juana", "JuanaBot")]:
        h = registrar_y_loguear(nombre=f"Owner {tid}", tenant_id=tid)[0]
        d = client.get(f"/api/botconfig?tenant={tid}", headers=h).json()
        assert d["nombre_bot"] == nombre
        assert d["saludo"] and d["tono"] == "cercano"


def test_botconfig_get_sin_token_401():
    assert client.get("/api/botconfig?tenant=faro").status_code == 401


def test_botconfig_put_y_el_bot_lo_usa(owner_headers):
    r = client.put("/api/botconfig", headers=owner_headers, json={
        "tenant": "faro", "nombre_bot": "CeviBot",
        "saludo": "Hola! Soy CeviBot, ¿te muestro la carta?",
        "tono": "formal", "instrucciones_extra": "Siempre ofrece chicha morada."})
    assert r.status_code == 200
    d = r.json()
    assert d["nombre_bot"] == "CeviBot" and d["tono"] == "formal"
    # menu_text saluda con el saludo del Asistente
    assert chat("faro", "B1", "hola").json()["reply"].startswith(
        "Hola! Soy CeviBot, ¿te muestro la carta?")
    # la identidad usa nombre_bot del BotConfig
    assert "Soy *CeviBot*" in chat("faro", "B2", "que eres").json()["reply"]
    # el prompt del LLM lleva nombre, línea de tono e instrucciones extras
    ctx = brain.context_block("faro")
    assert "Eres CeviBot" in ctx
    assert "siempre eres CeviBot" in ctx
    assert "Tu trato es formal pero cálido, sin jerga." in ctx
    assert "INSTRUCCIONES DEL DUEÑO (extras, sin contradecir las REGLAS)" in ctx
    assert "Siempre ofrece chicha morada." in ctx
    # las REGLAS del sistema quedan FIJAS y antes que las del dueño
    assert ctx.index("REGLAS (cortas, todas obligatorias)") < ctx.index(
        "INSTRUCCIONES DEL DUEÑO")
    assert "JAMAS hables de cocina" in ctx


def test_botconfig_put_instrucciones_max_800(owner_headers):
    largo = {"tenant": "faro", "instrucciones_extra": "x" * 801}
    assert client.put("/api/botconfig", headers=owner_headers,
                     json=largo).status_code == 422
    exacto = {"tenant": "faro", "instrucciones_extra": "x" * 800}
    assert client.put("/api/botconfig", headers=owner_headers,
                      json=exacto).status_code == 200


def test_botconfig_put_tono_invalido_422(owner_headers):
    assert client.put("/api/botconfig", headers=owner_headers,
                      json={"tenant": "faro", "tono": "grosero"}).status_code == 422


def test_botconfig_authz(owner_headers, staff_headers):
    assert client.put("/api/botconfig", json={"tenant": "faro",
                                             "tono": "formal"}).status_code == 401
    r = client.put("/api/botconfig", headers=staff_headers,
                   json={"tenant": "faro", "tono": "formal"})
    assert r.status_code == 403 and r.json()["detail"] == "Tu rol no permite manage_settings"
    brasa = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    assert client.put("/api/botconfig", headers=brasa,
                      json={"tenant": "faro", "tono": "formal"}).status_code == 403
    assert client.put("/api/botconfig", headers=owner_headers,
                      json={"tenant": "inexistente", "tono": "formal"}).status_code == 404


def test_menu_text_saludo_fallback_al_tenant():
    # local sin fila de BotConfig: saludo del tenant + nombre default
    with Session(engine) as session:
        row = session.get(BotConfig, "faro")
        session.delete(row)
        session.commit()
    assert bot.bot_config("faro")["saludo"] is None
    assert logic.menu_text("faro").startswith(data.TENANTS["faro"]["saludo"])
    assert bot.nombre_bot("faro") == "FaroBot"


def test_seed_idempotente_no_recrea_lo_existente(owner_headers):
    client.put("/api/botconfig", headers=owner_headers,
               json={"tenant": "faro", "nombre_bot": "Renombrado"})
    seed.run()  # re-hidratar
    seed.run()
    with Session(engine) as session:
        assert session.get(BotConfig, "faro").nombre_bot == "Renombrado"
    # la KB del faro tampoco se duplica por re-arranque
    temas = [e.tema for e in kb.kb_entries("faro", solo_activas=False)]
    assert temas.count("Horarios") == 1
    assert sorted(temas) == sorted(["Horarios", "Ubicación", "Promociones"])
