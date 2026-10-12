"""Persistencia real de pedidos/carta con espejo write-through (saas-cola-1).

data.MENUS y store.ORDERS/COUNTER SIGUEN siendo las estructuras en memoria que
todo el código ya usa (brain/logic/main las leen sin cambio de firma). Este
módulo las convierte en un espejo de SQLite:

- hydrate() al arrancar (import de main.py, idempotente): siembra order/
  menu_item si están vacías y CARGA el espejo desde la BD.
- menu_write/order_write/order_delete en cada punto de mutación: upsert/
  borrado en la BD + reflejo en el espejo. El caller ya mutó el dict en
  memoria; escribir aquí es lo que lo vuelve durable.

Cuidados:
- Los dicts del espejo usan las claves que logic espera ("desc", no la
  columna desc_) y "foto" va persistida en menu_item.
- created_at de Order se fija en el primer write y NO se pisa en updates.
- store.reset_demo() delega aquí (reset_db): demo fresca completa = tablas
  Order+MenuItem a seed + espejo actualizado. Por eso el snapshot _SEED_MENU
  se toma en el IMPORT de este módulo (antes de que hydrate cargue el
  espejo desde la BD): es la única copia de la carta original de data.py.
- CLIENT_STATE (direccion/esperando) NO se persiste: es estado de la
  conversación en curso, no del demo (sigue en store.py, solo memoria).
"""
import json
from copy import deepcopy

from sqlmodel import Session, select

from . import data, store
from .db import engine, init_db
from .models import MenuItem, Order

# carta original de data.py, congelada al importar (reset_db vuelve aquí;
# data.MENUS deja de ser la fuente original en cuanto hydrate lo hidrata).
_SEED_MENU = deepcopy(data.MENUS)


def _dump(x) -> str:
    return json.dumps(x, ensure_ascii=False)


def _foto(item_id: str) -> str:
    return f"/static/img/platos/{item_id}.jpg"


# ── siembra de tablas vacías ──

def _seed_menu_rows(session: Session) -> None:
    for tenant, items in _SEED_MENU.items():
        for it in items:
            session.add(MenuItem(id=it["id"], tenant_id=tenant,
                                 nombre=it["nombre"], desc_=it["desc"],
                                 precio=it["precio"], cat=it["cat"],
                                 disponible=it["disponible"], tags=it["tags"],
                                 foto=_foto(it["id"])))


def _seed_order_rows(session: Session) -> None:
    n = 100
    for s in data.SEED_ORDERS:
        n += 1
        session.add(Order(id=f"#{n}", tenant_id=s["tenant"],
                          cliente=s["cliente"], items=_dump(s["items"]),
                          total=s["total"], estado=s["estado"], pago=s["pago"],
                          direccion=s["direccion"], timeline=_dump(["creado"])))


# ── carga BD → espejo ──

def _menu_dict(row: MenuItem) -> dict:
    """El dict que logic espera: columna desc_ → clave "desc"."""
    return {"id": row.id, "nombre": row.nombre, "precio": row.precio,
            "cat": row.cat, "desc": row.desc_, "disponible": row.disponible,
            "tags": row.tags, "foto": row.foto}


def _order_dict(row: Order) -> dict:
    o = {"id": row.id, "tenant": row.tenant_id, "cliente": row.cliente,
         "items": json.loads(row.items), "total": row.total,
         "estado": row.estado, "pago": row.pago, "direccion": row.direccion,
         "timeline": json.loads(row.timeline)}
    if row.culqi_ref is not None:
        o["culqi_ref"] = row.culqi_ref
    if row.culqi_charge is not None:
        o["culqi_charge"] = row.culqi_charge
    return o


def _load_menu_mirror(rows: list[MenuItem]) -> None:
    menus: dict[str, list] = {}
    for r in rows:  # order_by id: f1..f6 conserva el orden de la carta
        menus.setdefault(r.tenant_id, []).append(_menu_dict(r))
    data.MENUS.clear()
    data.MENUS.update(menus)


def _load_order_mirror(rows: list[Order]) -> None:
    orders: dict[str, dict] = {}
    top = 100
    for r in rows:
        orders[r.id] = _order_dict(r)
        try:
            top = max(top, int(r.id.lstrip("#")))
        except ValueError:
            pass
    with store.LOCK:
        store.ORDERS.clear()
        store.ORDERS.update(orders)
        store.COUNTER["n"] = top


# ── API pública ──

def hydrate() -> None:
    """Arranque: siembra tablas vacías y carga el espejo desde la BD.

    Idempotente (patrón de seed.run): la primera corrida contra una BD vacía
    deja exactamente el demo que antes armaba store.reset_demo(); las
    siguientes recuperan pedidos/carta persistidos. AUTH_DB_PATH apunta los
    tests a su propia BD temporal.
    """
    init_db()
    with Session(engine) as session:
        if session.exec(select(MenuItem)).first() is None:
            _seed_menu_rows(session)
        if session.exec(select(Order)).first() is None:
            _seed_order_rows(session)
        session.commit()
        menu_rows = session.exec(
            select(MenuItem).order_by(MenuItem.id)).all()
        order_rows = session.exec(select(Order)).all()
    _load_menu_mirror(menu_rows)
    _load_order_mirror(order_rows)


def menu_write(tenant: str, item: dict) -> None:
    """Write-through de un plato: upsert menu_item + reflejo en data.MENUS."""
    row = MenuItem(id=item["id"], tenant_id=tenant,
                   nombre=item.get("nombre", ""), desc_=item.get("desc", ""),
                   precio=float(item.get("precio", 0)), cat=item.get("cat", ""),
                   disponible=bool(item.get("disponible", True)),
                   tags=item.get("tags", ""),
                   foto=item.get("foto", _foto(item["id"])))
    with Session(engine) as session:
        session.merge(row)
        session.commit()
    lista = data.MENUS.setdefault(tenant, [])
    cur = next((x for x in lista if x["id"] == item["id"]), None)
    if cur is None:
        lista.append(_menu_dict(row))
    else:
        cur.update(_menu_dict(row))


def order_write(o: dict) -> None:
    """Write-through de un pedido: upsert order + reflejo en store.ORDERS.

    created_at se fija en el INSERT y no se toca en los updates (el resto de
    campos siempre se copia del dict, fuente de verdad del espejo).
    """
    with Session(engine) as session:
        row = session.get(Order, o["id"])
        if row is None:
            row = Order(id=o["id"])
        row.tenant_id = o.get("tenant", "")
        row.cliente = o.get("cliente", "")
        row.items = _dump(o.get("items", []))
        row.total = float(o.get("total", 0))
        row.estado = o.get("estado", "nuevo")
        row.pago = o.get("pago", "pendiente")
        row.direccion = o.get("direccion", "")
        row.timeline = _dump(o.get("timeline", []))
        row.culqi_ref = o.get("culqi_ref")
        row.culqi_charge = o.get("culqi_charge")
        session.add(row)
        session.commit()
    with store.LOCK:
        store.ORDERS[o["id"]] = o


def order_delete(oid: str) -> None:
    """Borrado write-through: fila order fuera + fuera del espejo."""
    with Session(engine) as session:
        row = session.get(Order, oid)
        if row is not None:
            session.delete(row)
            session.commit()
    with store.LOCK:
        store.ORDERS.pop(oid, None)


def reset_db() -> None:
    """Demo fresca completa: tablas Order+MenuItem a seed + espejo.

    Llamado por store.reset_demo() (lo usan /api/demo/reset y el fixture
    autouse de los tests): borra TODAS las filas de ambas tablas y reinserta
    SEED_ORDERS (ids #101.., timeline ["creado"]) y la carta original
    (_SEED_MENU), con precios/disponibilidad de fábrica.
    """
    init_db()
    with Session(engine) as session:
        for row in session.exec(select(Order)).all():
            session.delete(row)
        for row in session.exec(select(MenuItem)).all():
            session.delete(row)
        _seed_menu_rows(session)
        _seed_order_rows(session)
        session.commit()
        menu_rows = session.exec(
            select(MenuItem).order_by(MenuItem.id)).all()
        order_rows = session.exec(select(Order)).all()
    _load_menu_mirror(menu_rows)
    _load_order_mirror(order_rows)
