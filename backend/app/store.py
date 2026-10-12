"""Estado en memoria del prototipo: pedidos y conversaciones.

Un solo módulo para que main (HTTP) y brain (LLM) compartan la misma fuente
de verdad sin imports circulares. Desde saas-cola-1, ORDERS/COUNTER (y
data.MENUS) son un ESPEJO de SQLite: persist.py los hidrata al arrancar y
les hace write-through en cada mutación (ver persist.py).
"""
import threading
import unicodedata

LOCK = threading.RLock()

# pedidos vivos, keyed por "#101" — espejo de la tabla order (persist.py)
ORDERS: dict = {}
COUNTER = {"n": 100}

# estado conversacional por (tenant, cliente): direccion capturada,
# esperando='direccion'. Es de la conversación, no del demo: sobrevive al reset
# y NO se persiste (saas-cola-1 solo persiste pedidos/carta): si el proceso
# muere, el cliente la vuelve a dar.
CLIENT_STATE: dict[tuple[str, str], dict] = {}


def client_key(tenant: str, customer: str) -> tuple[str, str]:
    return tenant, ((customer or "").strip().lower() or "demo")


def client_state(tenant: str, customer: str) -> dict:
    return CLIENT_STATE.setdefault(client_key(tenant, customer), {})


def reset_demo():
    """Demo fresca completa: delega en persist.reset_db() (borra TODAS las
    filas Order + MenuItem de SQLite, reinserta SEED_ORDERS y la carta
    original, y actualiza este espejo). Import tardío: persist importa
    store (el espejo) y store no puede importarlo al tope."""
    with LOCK:
        from . import persist
        persist.reset_db()


def track_orders(tenant: str, cliente: str) -> list:
    """Pedidos del cliente en un local: match de nombre sin acentos, por
    prefijo o contenido ("maria" encuentra "María", "María Fernanda")."""
    def flat(s: str) -> str:
        s = unicodedata.normalize("NFD", (s or "").lower())
        return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()

    target = flat(cliente)
    if not target:
        return []
    with LOCK:
        vals = [o for o in ORDERS.values() if o["tenant"] == tenant]
    out = []
    for o in vals:
        oname = flat(o["cliente"])
        if oname == target or oname.startswith(target) or target in oname:
            out.append(o)
    return sorted(out, key=lambda x: x["id"], reverse=True)
