"""Tests del change horarios-pausa-notif-perfil (contrato completo).

A. Horarios: seed 7×3 tenants idempotente, GET (7 filas + abierto_ahora +
   mensaje_estado por hora), PATCH cambia y valida (HH:MM, apertura<cierre,
   authz), estado_local con día inactivo (cierre→próximo día activo) y sin
   filas (defaults), bot cerrado NO toma pedido (carrito intacto) / abierto
   sí, cerrado + "menu" → carta normal, saludo cerrado lleva el estado,
   tracking/KB/fotos vivos cerrado, flujo de dirección gatado, y el mensaje
   del cliente queda guardado + unread SIEMPRE (process_incoming).
B. Pausa: GET devuelve pausado, PATCH (y PUT) lo setean, pausado → reply
   fija con carrito intacto y SIN NLU ni LLM (spies), despausa → normal,
   fail-open sin tabla.
C. WS: message.created trae tenant_id, cliente (nombre), role y body.
D. PATCH /api/auth/me: nombre (login refleja), password ok (token viejo
   sigue válido — JWT stateless), actual incorrecta 400 verbatim, min 8 → 422.

La hora se fija monkeypatcheando horarios.hora_lima (el único punto que lee
el reloj — ver su docstring); conftest ya fija una hora ABIERTA para toda la
suite y estos tests la re-fijan abierta/cerrada según el caso.
"""
import uuid
from datetime import datetime

import pytest
from conftest import client, registrar_y_loguear
from sqlmodel import Session, select

from app import bot, brain, horarios, logic, seed, store
from app.db import engine
from app.models import BotConfig, Horario

PAUSA_REPLY = ("Ahora te está atendiendo el equipo del local. "
               "Déjanos tu mensaje y te respondemos en breve.")
CERRADO = "Estamos cerrados"
# 2026-10-12 es LUNES (weekday()==0 == dia 0 del Horario): base de todas las
# horas fijas de la suite.
LUNES = datetime(2026, 10, 12)


@pytest.fixture(autouse=True)
def _mundo_restaurado():
    """Cada test nace y muere con el demo de fábrica y los horarios/Asistente
    re-sembrados de cero (borrar todo + seed.run idempotente): los PATCH de
    esta suite no se filtran al resto de la corrida."""
    store.reset_demo()
    yield
    store.reset_demo()
    with Session(engine) as session:
        for row in session.exec(select(BotConfig)).all():
            session.delete(row)
        for row in session.exec(select(Horario)).all():
            session.delete(row)
        session.commit()
    seed.run()


# ── helpers ──

def lunes(h: int, m: int = 0) -> datetime:
    """Lunes 15:00/23:00… hora de pared Lima, para fijar el reloj."""
    return datetime(2026, 10, 12, h, m)


def fijar(monkeypatch, cuando: datetime) -> None:
    monkeypatch.setattr(horarios, "hora_lima", lambda: cuando)


def chat(tenant, customer, message, cart=None):
    return client.post("/api/chat", json={
        "tenant": tenant, "customer": customer,
        "message": message, "cart": cart or []})


def cliente_unico() -> str:
    return f"Cliente-{uuid.uuid4().hex[:8]}"


def patch_horarios(headers, tenant="faro", activos=None,
                   apertura="12:00", cierre="22:00"):
    """PATCH completo: 7 días, activos = set de dias activos (None = todos)."""
    dias = [{"dia": d, "activo": activos is None or d in activos,
             "apertura": apertura, "cierre": cierre} for d in range(7)]
    return client.patch("/api/horarios", headers=headers,
                        json={"tenant": tenant, "dias": dias})


def get_horarios(headers, tenant="faro"):
    return client.get(f"/api/horarios?tenant={tenant}", headers=headers)


def contar_filas(tenant: str) -> int:
    with Session(engine) as session:
        return len(session.exec(select(Horario).where(
            Horario.tenant_id == tenant)).all())


# ══ A. Horarios de atención ══

def test_seed_siete_filas_por_tres_tenants():
    for tid in ("faro", "brasa", "juana"):
        h = registrar_y_loguear(nombre=f"Owner {tid}", tenant_id=tid)[0]
        r = get_horarios(h, tid)
        assert r.status_code == 200
        d = r.json()
        assert [x["dia"] for x in d["dias"]] == list(range(7))  # Lun..Dom
        assert all(x["activo"] and x["apertura"] == "12:00"
                   and x["cierre"] == "22:00" for x in d["dias"])
        assert contar_filas(tid) == 7
    seed.run()  # re-arranque: idempotente, no duplica
    seed.run()
    assert contar_filas("faro") == 7


def test_get_abierto_cerrado_por_hora(owner_headers, monkeypatch):
    fijar(monkeypatch, lunes(15))  # lunes 15:00: dentro de 12:00-22:00
    d = get_horarios(owner_headers).json()
    assert d["abierto_ahora"] is True
    assert d["mensaje_estado"] == "Abierto — cierra a las 22:00"
    fijar(monkeypatch, lunes(10))  # abre más tarde HOY
    d = get_horarios(owner_headers).json()
    assert d["abierto_ahora"] is False
    assert d["mensaje_estado"] == "Cerrado — abre a las 12:00"
    fijar(monkeypatch, lunes(23))  # ya cerró: próxima apertura es MAÑANA
    d = get_horarios(owner_headers).json()
    assert d["abierto_ahora"] is False
    assert d["mensaje_estado"] == "Cerrado — abre el martes a las 12:00"
    fijar(monkeypatch, lunes(12))  # borde: apertura<=t<cierre
    assert get_horarios(owner_headers).json()["abierto_ahora"] is True
    fijar(monkeypatch, lunes(22))  # borde de cierre: 22:00 exacto YA cerró
    assert get_horarios(owner_headers).json()["abierto_ahora"] is False


def test_estado_local_dia_inactivo_salta_al_proximo_dia_activo(
        owner_headers, monkeypatch):
    patch_horarios(owner_headers, activos={2})  # SOLO miércoles activo
    fijar(monkeypatch, lunes(15))
    assert horarios.estado_local("faro") == (
        False, "Cerrado — abre el miércoles a las 12:00")
    # lunes YA cerró y mañana (martes) abre: nombre del día siguiente
    patch_horarios(owner_headers, activos={0, 1})  # lunes y martes activos
    fijar(monkeypatch, lunes(23))
    assert horarios.estado_local("faro") == (
        False, "Cerrado — abre el martes a las 12:00")
    # el único día activo YA pasó esta semana: próxima apertura, el lunes...
    patch_horarios(owner_headers, activos={0})  # solo lunes
    fijar(monkeypatch, lunes(23))
    assert horarios.estado_local("faro") == (
        False, "Cerrado — abre el lunes a las 12:00")  # …de la SEMANA que viene
    # inyección DIRECTA por parámetro now= (segunda vía del contrato)
    assert horarios.estado_local("faro", now=lunes(23)) == (
        False, "Cerrado — abre el lunes a las 12:00")
    assert horarios.estado_local("faro", now=lunes(13)) == (
        True, "Abierto — cierra a las 22:00")
    # ningún día activo: mensaje honesto, no inventa apertura
    patch_horarios(owner_headers, activos=set())
    fijar(monkeypatch, lunes(15))
    abierto, mensaje = horarios.estado_local("faro")
    assert abierto is False and "sin días" in mensaje


def test_estado_local_datetime_aware_se_convierte(owner_headers, monkeypatch):
    # now= con tzinfo (aware) se convierte a Lima: 20:00 UTC == 15:00 Lima
    from datetime import timezone as tz

    from app.horarios import ZONA
    assert horarios.estado_local(
        "faro", now=datetime(2026, 10, 12, 20, 0, tzinfo=tz.utc)) == (
        True, "Abierto — cierra a las 22:00")
    monkeypatch.setattr(horarios, "hora_lima",
                        lambda: datetime(2026, 10, 12, 20, 0, tzinfo=ZONA))
    assert horarios.estado_local("faro")[0] is True


def test_patch_cambia_horarios_y_persiste(owner_headers, monkeypatch):
    r = patch_horarios(owner_headers, apertura="09:30", cierre="18:45",
                       activos={0, 1, 2, 3, 4, 5})  # domingo inactivo
    assert r.status_code == 200
    d = r.json()
    assert d["dias"][6]["activo"] is False
    assert d["dias"][0]["apertura"] == "09:30" and d["dias"][0]["cierre"] == "18:45"
    assert contar_filas("faro") == 7  # upsert, no duplica
    with Session(engine) as session:  # write-through: la fila dice lo mismo
        row = session.exec(select(Horario).where(
            Horario.tenant_id == "faro", Horario.dia == 0)).first()
        assert row.activo is True and row.apertura == "09:30"
    fijar(monkeypatch, lunes(20))  # fuera de la ventana nueva
    assert horarios.estado_local("faro") == (
        False, "Cerrado — abre el martes a las 09:30")
    fijar(monkeypatch, lunes(10))  # dentro de la ventana nueva
    assert horarios.estado_local("faro") == (True, "Abierto — cierra a las 18:45")
    # PATCH PARCIAL: solo el día que viene; el resto queda como estaba
    r = client.patch("/api/horarios", headers=owner_headers,
                     json={"tenant": "faro", "dias": [
                         {"dia": 6, "activo": True,
                          "apertura": "13:00", "cierre": "21:00"}]})
    assert r.status_code == 200
    d = get_horarios(owner_headers).json()
    assert d["dias"][6] == {"dia": 6, "activo": True,
                            "apertura": "13:00", "cierre": "21:00"}
    assert d["dias"][0]["apertura"] == "09:30"  # lunes intacto
    assert d["dias"][1]["cierre"] == "18:45"  # martes intacto


def test_patch_validaciones_422(owner_headers):
    base = {"dia": 0, "activo": True, "apertura": "12:00", "cierre": "22:00"}
    assert client.patch("/api/horarios", headers=owner_headers,
                        json={"tenant": "faro", "dias": []}).status_code == 422
    assert client.patch(
        "/api/horarios", headers=owner_headers,
        json={"tenant": "faro",
              "dias": [dict(base, apertura="9:30")]}).status_code == 422  # HH:M
    assert client.patch(
        "/api/horarios", headers=owner_headers,
        json={"tenant": "faro",
              "dias": [dict(base, cierre="24:00")]}).status_code == 422
    assert client.patch(
        "/api/horarios", headers=owner_headers,
        json={"tenant": "faro",
              "dias": [dict(base, apertura="22:00", cierre="12:00")]
              }).status_code == 422  # ventana invertida
    assert client.patch(
        "/api/horarios", headers=owner_headers,
        json={"tenant": "faro",
              "dias": [dict(base, apertura="12:00", cierre="12:00")]
              }).status_code == 422  # ventana nula
    assert client.patch(
        "/api/horarios", headers=owner_headers,
        json={"tenant": "faro", "dias": [dict(base, dia=7)]}).status_code == 422
    # nada se guardó con los payloads inválidos
    with Session(engine) as session:
        assert len(session.exec(select(Horario)).all()) == 21  # 3 tenants × 7


def test_horarios_authz(owner_headers, staff_headers):
    assert get_horarios(None).status_code == 401
    assert client.patch("/api/horarios", json={"tenant": "faro", "dias": []}
                        ).status_code == 401
    r = client.patch("/api/horarios", headers=staff_headers,
                     json={"tenant": "faro", "dias": [
                         {"dia": 0, "activo": True,
                          "apertura": "12:00", "cierre": "22:00"}]})
    assert r.status_code == 403 and r.json()["detail"] == \
        "Tu rol no permite manage_settings"
    brasa = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    assert get_horarios(brasa).status_code == 403  # GET: solo del propio local
    assert client.patch(  # PATCH de faro por el dueño de brasa: body válido
        "/api/horarios", headers=brasa, json={"tenant": "faro", "dias": [
            {"dia": 0, "activo": True, "apertura": "12:00",
             "cierre": "22:00"}]}).status_code == 403
    assert get_horarios(owner_headers, "inexistente").status_code == 404
    assert client.patch(  # body válido: el 404 sale del check de tenant
        "/api/horarios", headers=owner_headers,
        json={"tenant": "inexistente", "dias": [
            {"dia": 0, "activo": True, "apertura": "12:00",
             "cierre": "22:00"}]}).status_code == 404


def test_get_sin_filas_cae_a_defaults(owner_headers, monkeypatch):
    """Local sin filas (recién nacido antes del seed): GET responde los 7
    defaults y el gate opera con ellos — el bot nunca se rompe (fail-open)."""
    with Session(engine) as session:
        for row in session.exec(select(Horario).where(
                Horario.tenant_id == "faro")).all():
            session.delete(row)
        session.commit()
    fijar(monkeypatch, lunes(15))
    d = get_horarios(owner_headers).json()
    assert [x["dia"] for x in d["dias"]] == list(range(7))
    assert all(x["activo"] and x["apertura"] == "12:00" for x in d["dias"])
    assert d["abierto_ahora"] is True
    fijar(monkeypatch, lunes(23))
    assert get_horarios(owner_headers).json()["mensaje_estado"] == \
        "Cerrado — abre el martes a las 12:00"


def test_tenant_nuevo_nace_con_horarios(owner_headers):
    """El registro CON negocio siembra los 7 horarios del local nuevo."""
    email = f"negocio-{uuid.uuid4().hex[:8]}@test.pe"
    r = client.post("/api/auth/register", json={
        "email": email, "password": "secreto123", "nombre": "Owner Nuevo",
        "negocio": {"nombre": "Chifa Estrellita 8", "distrito": "La Victoria",
                    "delivery": 4}})
    assert r.status_code == 201
    tid = r.json()["tenant_id"]
    h = client.post("/api/auth/login",
                    json={"email": email, "password": "secreto123"}
                    ).json()["access_token"]
    d = get_horarios({"Authorization": f"Bearer {h}"}, tid).json()
    assert len(d["dias"]) == 7 and all(x["activo"] for x in d["dias"])
    assert contar_filas(tid) == 7


# ── A. Bot vs horario: cerrado NO toma pedido, abierto sí ──

def test_cerrado_no_toma_pedido_y_carrito_intacto(monkeypatch):
    fijar(monkeypatch, lunes(23))
    wa = cliente_unico()
    r = chat("faro", wa, "quiero 2 ceviche")
    d = r.json()
    assert d["reply"].startswith(CERRADO)
    assert "Cerrado — abre el martes a las 12:00" in d["reply"]
    assert "Puedo mostrarte la carta" in d["reply"]
    assert d["cart"] == []  # el carrito entró vacío y vuelve vacío

    cart = [{"id": "f1", "cant": 2, "nombre": "Ceviche clásico",
             "precio": 32.0}]
    for msg in ("confirmar", "si", "culqi", "Av Encalada 789"):
        d = chat("faro", wa, msg, cart=cart).json()
        assert d["reply"].startswith(CERRADO), msg
        assert d["cart"] == cart  # INTACTO: no se confirmó ni se cobró nada
        assert d.get("next") != "pago"
    # y abrir temprano (antes de las 12) es igual de cerrado
    fijar(monkeypatch, lunes(10))
    assert chat("faro", wa, "quiero 2 ceviche").json()["reply"].startswith(
        CERRADO)


def test_abierto_si_toma_pedido(monkeypatch):
    fijar(monkeypatch, lunes(15))  # hora ABIERTA (la misma del conftest)
    wa = cliente_unico()
    d = chat("faro", wa, "quiero 2 ceviche").json()
    assert {c["id"]: c["cant"] for c in d["cart"]} == {"f1": 2.0}
    d = chat("faro", wa, "confirmar", cart=d["cart"]).json()
    assert d.get("next") == "pago" or "dirección" in d["reply"].lower()
    assert CERRADO not in d["reply"]


def test_cerrado_menu_fotos_tracking_kb_igual_que_abierto(monkeypatch):
    fijar(monkeypatch, lunes(23))
    wa = cliente_unico()
    # "menu" (carta) responde NORMAL cerrado, sin mencionar el cierre
    d = chat("faro", wa, "menu").json()
    assert "Carta hoy" in d["reply"] and CERRADO not in d["reply"]
    # fotos: la ficha con foto sigue viva
    d = chat("faro", wa, "tienes foto del ceviche?").json()
    assert d.get("foto") and CERRADO not in d["reply"]
    # tracking: el estado del pedido de María responde igual
    d = chat("faro", "María", "donde esta mi pedido?").json()
    assert "#101" in d["reply"] and CERRADO not in d["reply"]
    # KB: el horario del local lo responde la entrada, no el gate
    d = chat("faro", wa, "a que hora abren?").json()
    assert d["reply"] == "Lun a Dom, 12:00 a 22:00"


def test_saludo_cerrado_incluye_estado(monkeypatch):
    fijar(monkeypatch, lunes(23))
    wa = cliente_unico()
    d = chat("faro", wa, "hola").json()
    assert d["reply"].startswith(
        "Estamos cerrados — abrimos el martes a las 12:00")
    assert "Carta hoy" in d["reply"]  # la carta sigue, con el estado encima
    fijar(monkeypatch, lunes(10))  # abre HOY más tarde: la frase cambia
    d = chat("faro", wa, "hola").json()
    assert d["reply"].startswith("Estamos cerrados — abrimos a las 12:00")


def test_flujo_direccion_pendiente_se_gata_cerrado(monkeypatch):
    fijar(monkeypatch, lunes(15))
    wa = cliente_unico()
    cart = [{"id": "f1", "cant": 2, "nombre": "Ceviche clásico",
             "precio": 32.0}]
    d = chat("faro", wa, "confirmar", cart=cart).json()
    assert "dirección" in d["reply"].lower()  # el flujo quedó esperando
    # cierra el local a mitad del flujo: la dirección NO se toma como pedido
    fijar(monkeypatch, lunes(23))
    d = chat("faro", wa, "Av Encalada 789", cart=cart).json()
    assert d["reply"].startswith(CERRADO)
    assert d["cart"] == cart and d.get("next") != "pago"
    # el flujo murió con el cierre: la carta vuelve a responder normal
    d = chat("faro", wa, "menu").json()
    assert "Carta hoy" in d["reply"] and CERRADO not in d["reply"]


def test_mensaje_cerrado_guardado_y_unread(owner_headers, monkeypatch):
    fijar(monkeypatch, lunes(23))
    wa = cliente_unico()
    chat("faro", wa, "quiero 2 ceviche")
    convs = client.get("/api/conversations?tenant=faro",
                       headers=owner_headers).json()
    conv = next(c for c in convs if c["wa_id"] == wa)
    assert conv["unread"] == 1  # guardado + unread SIEMPRE (process_incoming)
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                     headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot"]
    assert msgs[1]["body"].startswith(CERRADO)  # la respuesta fija quedó en hilo


# ══ B. Pausa del bot ══

def test_botconfig_get_devuelve_pausado_false(owner_headers):
    r = client.get("/api/botconfig?tenant=faro", headers=owner_headers)
    assert r.status_code == 200 and r.json()["pausado"] is False


def test_pausa_toggle_y_reply_fija(owner_headers, monkeypatch):
    r = client.patch("/api/botconfig", headers=owner_headers,
                     json={"tenant": "faro", "pausado": True})
    assert r.status_code == 200 and r.json()["pausado"] is True
    assert client.get("/api/botconfig?tenant=faro",
                      headers=owner_headers).json()["pausado"] is True
    fijar(monkeypatch, lunes(15))  # abierto: la pausa manda igual
    wa = cliente_unico()
    # NLU de pedido, carta y KB: TODO contesta la fija de la pausa
    for msg in ("quiero 2 ceviche", "menu", "a que hora abren?",
                "donde esta mi pedido?"):
        d = chat("faro", wa, msg).json()
        assert d["reply"] == PAUSA_REPLY, msg
        assert d["cart"] == []


def test_pausa_carrito_intacto_y_flujo_muerto(owner_headers, monkeypatch):
    client.patch("/api/botconfig", headers=owner_headers,
                 json={"tenant": "faro", "pausado": True})
    cart = [{"id": "f1", "cant": 2, "nombre": "Ceviche clásico",
             "precio": 32.0}]
    wa = cliente_unico()
    for msg in ("confirmar", "culqi", "quiero 1 inca"):
        d = chat("faro", wa, msg, cart=cart).json()
        assert d["reply"] == PAUSA_REPLY
        assert d["cart"] == cart  # intacto: la pausa no muta nada
        assert d.get("next") != "pago"


def test_pausa_no_corre_nlu_ni_llm(owner_headers, monkeypatch):
    client.patch("/api/botconfig", headers=owner_headers,
                 json={"tenant": "faro", "pausado": True})
    llamadas = {"nlu": 0, "llm": 0}
    _nlu_real, _llm_real = logic.bot_reply, brain._llm_reply

    def _nlu(*a, **k):
        llamadas["nlu"] += 1
        return _nlu_real(*a, **k)

    def _llm(*a, **k):
        llamadas["llm"] += 1
        return _llm_real(*a, **k)

    monkeypatch.setattr(logic, "bot_reply", _nlu)
    monkeypatch.setattr(brain, "_llm_reply", _llm)
    # long tail puro (caería al LLM si el bot viviera): la pausa lo corta ANTES
    wa = cliente_unico()
    d = chat("faro", wa, "tengo una reunion de 10 personas, que me recomiendas?"
             ).json()
    assert d["reply"] == PAUSA_REPLY
    assert llamadas == {"nlu": 0, "llm": 0}  # pausa TOTAL: ni NLU ni LLM


def test_pausa_mensaje_guardado_y_unread(owner_headers):
    client.patch("/api/botconfig", headers=owner_headers,
                 json={"tenant": "faro", "pausado": True})
    wa = cliente_unico()
    chat("faro", wa, "menu")
    convs = client.get("/api/conversations?tenant=faro",
                       headers=owner_headers).json()
    conv = next(c for c in convs if c["wa_id"] == wa)
    assert conv["unread"] == 1  # cae al Inbox: el equipo lo contesta
    msgs = client.get(f"/api/conversations/{conv['id']}/messages",
                      headers=owner_headers).json()
    assert [m["role"] for m in msgs] == ["cliente", "bot"]
    assert msgs[1]["body"] == PAUSA_REPLY


def test_despausa_vuelve_a_lo_normal(owner_headers, monkeypatch):
    client.patch("/api/botconfig", headers=owner_headers,
                 json={"tenant": "faro", "pausado": True})
    d = client.patch("/api/botconfig", headers=owner_headers,
                     json={"tenant": "faro", "pausado": False}).json()
    assert d["pausado"] is False
    fijar(monkeypatch, lunes(15))
    wa = cliente_unico()
    d = chat("faro", wa, "menu").json()
    assert "Carta hoy" in d["reply"] and d["reply"] != PAUSA_REPLY
    d = chat("faro", wa, "quiero 2 ceviche").json()
    assert {c["id"]: c["cant"] for c in d["cart"]} == {"f1": 2.0}


def test_pausa_put_parcial_no_toca_el_toggle(owner_headers, monkeypatch):
    # PUT completo también lo setea (decisión: PUT acepta pausado)
    r = client.put("/api/botconfig", headers=owner_headers,
                   json={"tenant": "faro", "saludo": "Hola desde PUT",
                         "pausado": True})
    assert r.status_code == 200 and r.json()["pausado"] is True
    assert chat("faro", cliente_unico(), "menu").json()["reply"] == PAUSA_REPLY
    # PUT SIN la clave pausado: el resto se guarda, el toggle queda como está
    r = client.put("/api/botconfig", headers=owner_headers,
                   json={"tenant": "faro", "saludo": "Otro saludo"})
    assert r.status_code == 200 and r.json()["pausado"] is True
    assert r.json()["saludo"] == "Otro saludo"


def test_pausa_authz(owner_headers, staff_headers):
    assert client.patch("/api/botconfig",
                        json={"tenant": "faro", "pausado": True}
                        ).status_code == 401
    r = client.patch("/api/botconfig", headers=staff_headers,
                     json={"tenant": "faro", "pausado": True})
    assert r.status_code == 403 and r.json()["detail"] == \
        "Tu rol no permite manage_settings"
    brasa = registrar_y_loguear(nombre="Owner Brasa", tenant_id="brasa")[0]
    assert client.patch("/api/botconfig", headers=brasa,
                        json={"tenant": "faro", "pausado": True}
                        ).status_code == 403
    assert client.patch("/api/botconfig", headers=owner_headers,
                        json={"tenant": "inexistente", "pausado": True}
                        ).status_code == 404


def test_pausado_fail_open_sin_tabla(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("tabla inexistente")
    monkeypatch.setattr(bot, "Session", _boom)
    assert bot.bot_pausado("faro") is False  # sin tabla NO se pausa solo


# ══ C. WS: message.created con tenant_id/cliente/role/body ══

def test_ws_message_created_lleva_tenant_cliente_role_body(monkeypatch):
    headers, token = registrar_y_loguear()
    wa = cliente_unico()
    fijar(monkeypatch, lunes(15))  # abierto: el bot responde la carta
    with client.websocket_connect(f"/ws/orders?token={token}") as ws:
        r = chat("faro", wa, "menu")
        assert r.status_code == 200
        ev = ws.receive_json()  # conversation.updated
        assert ev["conversation"]["wa_id"] == wa
        eventos = []
        for _ in range(2):  # message.created ×2: cliente y bot
            ev = ws.receive_json()
            assert ev["event"] == "message.created"
            eventos.append(ev["message"])
        del eventos[0]["created_at"], eventos[1]["created_at"]
        assert eventos[0] == {"id": eventos[0]["id"],
                              "conversation_id": eventos[0]["conversation_id"],
                              "role": "cliente", "body": "menu",
                              "tenant_id": "faro", "cliente": wa}
        assert eventos[1]["role"] == "bot"
        assert "Carta hoy" in eventos[1]["body"]
        assert eventos[1]["tenant_id"] == "faro" and eventos[1]["cliente"] == wa
        # los ids de BD viajan para que el front pueda abrir el hilo
        assert eventos[0]["id"] and eventos[0]["conversation_id"]


# ══ D. PATCH /api/auth/me ══

def registrar_usuario(email=None, password="secreto123", nombre="Nombre Original"):
    email = email or f"user-{uuid.uuid4().hex[:8]}@test.pe"
    r = client.post("/api/auth/register", json={
        "email": email, "password": password, "nombre": nombre,
        "tenant_id": "faro"})
    assert r.status_code == 201
    return email, password


def login(email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def patch_me(headers, payload):
    return client.patch("/api/auth/me", headers=headers, json=payload)


def test_patch_me_nombre_sin_password():
    email, password = registrar_usuario()
    h = login(email, password)
    r = patch_me(h, {"nombre": "Nuevo Nombre"})
    assert r.status_code == 200 and r.json()["nombre"] == "Nuevo Nombre"
    assert r.json()["email"] == email  # misma forma que GET /me
    assert client.get("/api/auth/me", headers=h).json()["nombre"] == "Nuevo Nombre"
    # el login refleja el nombre nuevo
    assert login(email, password) and client.post(
        "/api/auth/login", json={"email": email, "password": password}
        ).json()["user"]["nombre"] == "Nuevo Nombre"


def test_patch_me_password_ok_y_token_viejo_valido():
    email, password = registrar_usuario()
    h = login(email, password)
    r = patch_me(h, {"password_actual": password, "password_nueva": "nuevaclave9"})
    assert r.status_code == 200
    assert login(email, "nuevaclave9")  # la nueva entra
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 401  # la vieja ya no
    # JWT stateless (documentado en el docstring): el token ANTERIOR sigue vivo
    assert client.get("/api/auth/me", headers=h).status_code == 200


def test_patch_me_actual_incorrecta_400_verbatim():
    email, password = registrar_usuario()
    h = login(email, password)
    r = patch_me(h, {"password_actual": "no-es-la-mia",
                     "password_nueva": "nuevaclave9"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Contraseña actual incorrecta"
    # sin password_actual: mismo 400 (exigir la actual es parte del contrato)
    r = patch_me(h, {"password_nueva": "nuevaclave9"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Contraseña actual incorrecta"
    # la contraseña NO cambió en ninguno de los dos intentos
    assert login(email, password)
    assert client.post("/api/auth/login",
                       json={"email": email, "password": "nuevaclave9"}
                       ).status_code == 401


def test_patch_me_password_corta_422():
    email, password = registrar_usuario()
    h = login(email, password)
    r = patch_me(h, {"password_actual": password, "password_nueva": "corta1"})
    assert r.status_code == 422
    assert login(email, password)  # intacta


def test_patch_me_auth_y_payload_vacio():
    email, password = registrar_usuario()
    h = login(email, password)
    assert patch_me(None, {"nombre": "X"}).status_code == 401
    r = patch_me(h, {})  # no-op: devuelve el user tal cual
    assert r.status_code == 200 and r.json()["nombre"] == "Nombre Original"
    # nombre vacío → 422 (min_length=1)
    assert patch_me(h, {"nombre": ""}).status_code == 422
