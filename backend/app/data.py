"""Datos seed 3 locales — fuente única carta (RAG)."""
from copy import deepcopy

TENANTS = {
    "faro": {
        "id": "faro", "nombre": "Cevichería El Faro", "rubro": "comidas",
        "distrito": "Surco", "delivery": 5.0, "tiempo": "30-40 min",
        "yape_qr": "YA-FARO-123", "culqi_comision": 0.0344,
        "saludo": "Hola! Soy FaroBot de Cevichería El Faro. ¿Te muestro la carta?",
    },
    "brasa": {
        "id": "brasa", "nombre": "Pollería Brasa Viva", "rubro": "comidas",
        "distrito": "Miraflores", "delivery": 6.0, "tiempo": "25-35 min",
        "yape_qr": "YA-BRASA-456", "culqi_comision": 0.0344,
        "saludo": "Hola! Soy BrasaBot. Tenemos pollo a la brasa y combos. ¿Qué se te antoja?",
    },
    "juana": {
        "id": "juana", "nombre": "Menú Doña Juana", "rubro": "comidas",
        "distrito": "Jesús María", "delivery": 4.0, "tiempo": "20-30 min",
        "yape_qr": "YA-JUANA-789", "culqi_comision": 0.0344,
        "saludo": "Hola! Menú del día S/15. ¿Te digo las opciones de hoy?",
    },
}

MENUS = {
    "faro": [
        {"id": "f1", "nombre": "Ceviche clásico", "precio": 32.0, "cat": "Criollos", "desc": "Pesca del día, limón, choclo, camote", "disponible": True, "stock": 8, "tags": "pescado limon ceviche"},
        {"id": "f2", "nombre": "Lomo saltado", "precio": 34.0, "cat": "Criollos", "desc": "Lomo, cebolla, tomate, papas", "disponible": True, "tags": "carne lomo"},
        {"id": "f3", "nombre": "Arroz con mariscos", "precio": 36.0, "cat": "Marinos", "desc": "Arroz, mixtura, parmesano", "disponible": True, "tags": "arroz mariscos"},
        {"id": "f4", "nombre": "Chicha morada 1L", "precio": 10.0, "cat": "Bebidas", "desc": "Natural", "disponible": True, "tags": "bebida chicha"},
        {"id": "f5", "nombre": "Inca Kola 500ml", "precio": 6.0, "cat": "Bebidas", "desc": "Personal", "disponible": True, "tags": "gaseosa inca"},
        # stock 0 (carta-inventario-bot): se ve el estado "AGOTADO" en el demo.
        # Sin la clave = ilimitado (default de todos los demás).
        {"id": "f6", "nombre": "Tiradito nikkei", "precio": 30.0, "cat": "Marinos", "desc": "Láminas pesca, salsa nikkei", "disponible": False, "stock": 0, "tags": "tiradito pescado"},
    ],
    "brasa": [
        {"id": "b1", "nombre": "Pollo entero + papas + ensalada", "precio": 72.0, "cat": "Pollos", "desc": "Para 4, incluye salsas", "disponible": True, "tags": "pollo entero brasa"},
        {"id": "b2", "nombre": "1/2 pollo + papas", "precio": 39.0, "cat": "Pollos", "desc": "Para 2", "disponible": True, "tags": "medio pollo"},
        {"id": "b3", "nombre": "1/4 pollo + papas", "precio": 22.0, "cat": "Pollos", "desc": "Personal", "disponible": True, "tags": "cuarto pollo"},
        {"id": "b4", "nombre": "Salchipapa brasa", "precio": 16.0, "cat": "Extras", "desc": "Salchicha, papas, huevo", "disponible": True, "tags": "salchipapa"},
        {"id": "b5", "nombre": "Inca Kola 1L", "precio": 9.0, "cat": "Bebidas", "desc": "Familiar", "disponible": True, "tags": "gaseosa"},
    ],
    "juana": [
        {"id": "j1", "nombre": "Menú del día (sopa+segundo+refresco)", "precio": 15.0, "cat": "Menú", "desc": "Hoy: aguadito + ají de gallina", "disponible": True, "tags": "menu dia economico"},
        {"id": "j2", "nombre": "Ají de gallina + arroz", "precio": 18.0, "cat": "Criollos", "desc": "Presa, aceituna, huevo", "disponible": True, "tags": "aji gallina"},
        {"id": "j3", "nombre": "Seco de res con frejoles", "precio": 19.0, "cat": "Criollos", "desc": "Res, culantro, frejoles", "disponible": True, "tags": "seco res"},
        {"id": "j4", "nombre": "Refresco del día", "precio": 4.0, "cat": "Bebidas", "desc": "Maracuyá", "disponible": True, "tags": "refresco"},
    ],
}

# pedidos demo seed (Kanban inicial)
SEED_ORDERS = [
    {"tenant": "faro", "cliente": "María", "items": [{"id": "f1", "cant": 2}], "total": 69.0, "estado": "nuevo", "pago": "pendiente", "direccion": "Av Encalada 123"},
    {"tenant": "faro", "cliente": "Luis", "items": [{"id": "f2", "cant": 1}, {"id": "f5", "cant": 2}], "total": 51.0, "estado": "cocina", "pago": "pagado_culqi", "direccion": "Jr Luna 456"},
    {"tenant": "brasa", "cliente": "Ana", "items": [{"id": "b2", "cant": 1}], "total": 45.0, "estado": "confirmado", "pago": "pagado_culqi", "direccion": "Calle Lima 789"},
    {"tenant": "brasa", "cliente": "Pedro", "items": [{"id": "b3", "cant": 2}], "total": 50.0, "estado": "nuevo", "pago": "pendiente_verificar", "direccion": "Av Pardo 111"},
    {"tenant": "juana", "cliente": "Rosa", "items": [{"id": "j1", "cant": 3}], "total": 49.0, "estado": "delivery", "pago": "pagado_yape", "direccion": "Jr Huáscar 222"},
    {"tenant": "juana", "cliente": "Carlos", "items": [{"id": "j2", "cant": 1}], "total": 22.0, "estado": "nuevo", "pago": "pendiente", "direccion": "Av Brasil 333"},
]

def get_menu(tenant: str):
    items = deepcopy(MENUS.get(tenant, []))
    for it in items:
        it["foto"] = f"/static/img/platos/{it['id']}.jpg"
    return items

STOPWORDS = {"con", "los", "las", "por", "para", "una", "unos", "unas", "del",
             "que", "como", "tiene", "tienen", "hay", "esta", "este", "esto",
             "quiero", "dame", "pagar", "pago"}


def _flat(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def find_item(tenant: str, text: str):
    """RAG simple: keyword match nombre/tags/categoría. No inventa."""
    words = [w for w in _flat(text).split() if len(w) > 2 and w not in STOPWORDS]
    scored = []
    for it in MENUS.get(tenant, []):
        blob = _flat(f"{it['nombre']} {it['desc']} {it['cat']} {it['tags']}")
        score = sum(1 for w in words if w in blob)
        if _flat(it["nombre"]) in _flat(text):
            score += 5
        if score > 0:
            scored.append((score, it))
    scored.sort(key=lambda x: -x[0])
    out = [deepcopy(s[1]) for s in scored[:5]]
    for it in out:
        it["foto"] = f"/static/img/platos/{it['id']}.jpg"
    return out
