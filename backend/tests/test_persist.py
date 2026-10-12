"""Persistencia real de pedidos/carta (change saas-cola-1): espejo write-through.

El espejo en memoria (store.ORDERS / data.MENUS) debe reflejar SIEMPRE lo que
hay en SQLite. Estos tests golpean la API (los puntos de mutación con
write-through) y verifican las FILAS directamente con SQLModel contra el
engine de tests (AUTH_DB_PATH temporal de conftest).
"""
import json
from urllib.parse import quote

import pytest
from conftest import client, registrar_y_loguear
from sqlmodel import Session, select

from app import data, persist, store
from app.data import SEED_ORDERS
from app.db import engine
from app.models import MenuItem, Order


@pytest.fixture(autouse=True)
def _demo_limpia():
    store.reset_demo()
    yield
    store.reset_demo()


def fila_order(oid: str) -> Order | None:
    with Session(engine) as session:
        return session.get(Order, oid)


def crear_pedido(cliente="Persist", tenant="faro",
                 items=None, direccion="Av Prueba 100") -> dict:
    r = client.post("/api/orders", json={
        "tenant": tenant, "cliente": cliente,
        "items": items or [{"id": "f1", "cant": 2}], "direccion": direccion})
    assert r.status_code == 200
    return r.json()


# ── carta: toggle → fila menu_item ──

def test_toggle_precio_y_disponible_persisten_menuitem():
    headers, _ = registrar_y_loguear()
    r = client.post("/api/menu/toggle", headers=headers,
                    json={"tenant": "faro", "id": "f1", "precio": 33.5})
    assert r.status_code == 200
    r = client.post("/api/menu/toggle", headers=headers,
                    json={"tenant": "faro", "id": "f6", "disponible": True})
    assert r.status_code == 200
    with Session(engine) as session:
        f1 = session.get(MenuItem, "f1")
        f6 = session.get(MenuItem, "f6")
        # la fila refleja el cambio de precio/disponibilidad hecho por la API
        assert f1.precio == 33.5 and f1.tenant_id == "faro"
        assert f1.desc_ == "Pesca del día, limón, choclo, camote"  # desc_ → "desc"
        assert f1.foto == "/static/img/platos/f1.jpg"
        assert f6.disponible is True  # nacía agotado en el seed


def test_menu_toggle_sin_cambio_no_toca_la_bd():
    headers, _ = registrar_y_loguear()
    with Session(engine) as session:
        antes = session.get(MenuItem, "f1").precio
    r = client.post("/api/menu/toggle", headers=headers,
                    json={"tenant": "faro", "id": "f1"})
    assert r.status_code == 200
    with Session(engine) as session:
        assert session.get(MenuItem, "f1").precio == antes


# ── pedidos: crear/avanzar/pagar → fila order con timeline ──

def test_crear_y_avanzar_pedido_persiste_con_timeline():
    headers, _ = registrar_y_loguear()
    o = crear_pedido()
    row = fila_order(o["id"])
    assert row is not None
    assert row.tenant_id == "faro" and row.cliente == "Persist"
    assert json.loads(row.items) == [{"id": "f1", "cant": 2}]
    assert row.estado == "nuevo" and row.pago == "pendiente"
    assert json.loads(row.timeline) == ["creado"]
    assert row.created_at is not None

    # pagar con Yape exacto y avanzar: cada mutación recalca la fila
    client.post("/api/payments/yape",
                json={"order_id": o["id"], "monto_foto": o["total"]})
    row = fila_order(o["id"])
    assert row.pago == "pagado_yape"
    assert json.loads(row.timeline) == ["creado", "pagado_yape"]

    r = client.patch(f"/api/orders/{quote(o['id'])}", json={"estado": "cocina"},
                     headers=headers)
    assert r.status_code == 200
    row = fila_order(o["id"])
    assert row.estado == "cocina"
    assert json.loads(row.timeline) == ["creado", "pagado_yape", "cocina"]
    primera_vez = row.created_at
    # el update NO pisa created_at (se fija solo en el INSERT)
    assert row.created_at == primera_vez


def test_culqi_link_y_webhook_persisten_referencia():
    o = crear_pedido(cliente="Culqi")
    link = client.post("/api/payments/culqi/link",
                       json={"tenant": "faro", "order_id": o["id"]}).json()
    row = fila_order(o["id"])
    assert row.culqi_ref == link["reference_id"]
    assert json.loads(row.timeline) == ["creado", "link_culqi"]

    wh = client.post("/api/payments/culqi/webhook",
                     json={"reference_id": link["reference_id"]}).json()
    assert wh["ok"]
    row = fila_order(o["id"])
    assert row.pago == "pagado_culqi" and row.culqi_ref == link["reference_id"]
    assert json.loads(row.timeline) == ["creado", "link_culqi", "pagado_culqi"]


def test_order_delete_borra_fila_y_espejo():
    o = crear_pedido(cliente="Efimero")
    persist.order_delete(o["id"])
    assert fila_order(o["id"]) is None
    assert o["id"] not in store.ORDERS


# ── reset_demo: demo fresca completa (ambas tablas) ──

def test_reset_demo_limpia_y_resiembra_ambas_tablas():
    headers, _ = registrar_y_loguear()
    # ensuciar: pedido extra + precio/disponibilidad cambiados
    crear_pedido(cliente="Sucio", tenant="brasa", items=[{"id": "b1", "cant": 1}])
    client.post("/api/menu/toggle", headers=headers,
                json={"tenant": "faro", "id": "f1", "precio": 99})
    client.post("/api/menu/toggle", headers=headers,
                json={"tenant": "faro", "id": "f6", "disponible": True})

    store.reset_demo()

    with Session(engine) as session:
        orders = session.exec(select(Order)).all()
        # solo los SEED_ORDERS, con timeline de nacimiento y sin el pedido extra
        assert sorted(r.id for r in orders) == [
            f"#{n}" for n in range(101, 101 + len(SEED_ORDERS))]
        assert all(json.loads(r.timeline) == ["creado"] for r in orders)
        assert all(r.cliente != "Sucio" for r in orders)
        # la carta vuelve a seed: precio y disponibilidad de fábrica
        f1 = session.get(MenuItem, "f1")
        f6 = session.get(MenuItem, "f6")
        assert f1.precio == 32.0
        assert f6.disponible is False
    # el espejo queda coherente con la BD
    assert len(store.ORDERS) == len(SEED_ORDERS)
    assert store.COUNTER["n"] == 100 + len(SEED_ORDERS)
    assert store.ORDERS["#101"]["cliente"] == "María"
    assert store.ORDERS["#101"]["timeline"] == ["creado"]


# ── hydrate: el espejo se reconstruye DESDE la BD ──

def test_hydrate_recarga_el_espejo_desde_la_bd():
    headers, _ = registrar_y_loguear()
    client.post("/api/menu/toggle", headers=headers,
                json={"tenant": "faro", "id": "f2", "precio": 40})
    o = crear_pedido(cliente="Sobrevive")
    persist.hydrate()  # re-hidratar (lo que pasa al arrancar el server)

    f2 = next(x for x in data.MENUS["faro"] if x["id"] == "f2")
    assert f2["precio"] == 40.0
    assert f2["desc"] == "Lomo, cebolla, tomate, papas"  # clave "desc", no desc_
    assert f2["foto"] == "/static/img/platos/f2.jpg"
    # el pedido creado ANTES del re-hidratar vuelve desde SQLite
    assert o["id"] in store.ORDERS
    assert store.ORDERS[o["id"]]["cliente"] == "Sobrevive"
    assert store.ORDERS[o["id"]]["items"] == [{"id": "f1", "cant": 2}]
    assert store.COUNTER["n"] >= int(o["id"].lstrip("#"))


def test_seed_deja_demo_de_6_pedidos_y_carta_completa():
    """La siembra (hydrate en BD vacía y reset_db) deja el mismo demo que
    antes armaba store.reset_demo en memoria: 6 pedidos y 15 platos con foto."""
    with Session(engine) as session:
        orders = session.exec(select(Order)).all()
        assert len(orders) == len(SEED_ORDERS)
        menus = session.exec(select(MenuItem)).all()
        # 15 platos: 6 faro + 5 brasa + 4 juana, con foto persistida
        assert len(menus) == sum(len(v) for v in data.MENUS.values())
        assert all(m.foto == f"/static/img/platos/{m.id}.jpg" for m in menus)
