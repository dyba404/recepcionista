"""Lógica bot + pagos sandbox (sin dinero real).

Patrón intents + entities (cf. Kulkarni 2025 Dialogflow food-ordering):
cada mensaje se normaliza (minúsculas, sin tildes) y se clasifica en un intent
con entidades (plato, cantidad). Nada de match exacto: el usuario escribe
"que hay de menu", "quiero 2 ceviche + 1 inca", "cuanto esta el lomo".
"""
import re
import unicodedata
import uuid

from . import data

ESTADOS = ["nuevo", "confirmado", "cocina", "delivery", "entregado"]

# ── normalización ──
def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9ñ+&,;/ ]", " ", s)

# ── vocabulario intents (entidades: plato via data.find_item, cantidad via regex) ──
GREET = ("hola", "buenas", "buenos dias", "buenas tardes", "buenas noches",
         "hey", "alo", "holi", "inicio", "empezar", "ayuda", "help")
MENU_W = ("menu", "carta", "listado", "platos", "plato", "opciones", "que hay",
          "que tienen", "que ofrecen", "bebidas", "tragos", "postres", "precios",
          "cuanto", "coste", "muestra")
ORDER_V = ("quiero", "dame", "dames", "pideme", "ordenar", "agregar",
           "anademe", "ponme", "traeme", "llevo", "pido", "comprar",
           "apuntame", "separame")
LEAD_FILL = ORDER_V + ("por favor", "para llevar", "a domicilio", "gracias",
                       "hola", "buenas", "un", "unos", "unas")
PRICE_Q = ("cuanto", "cuesta", "cuestan", "precio", "vale", "valen", "tarifa")
PHOTO_W = ("foto", "fotos", "imagen", "imagenes", "ver el plato", "como se ve",
           "como es", "muestrame el plato", "picture", "pic")
FILLER = ("mm", "mmm", "mmmm", "este", "pues", "a ver", "o sea", "osea",
          "porfa", "por favor")
THANKS = ("gracias", "muchas gracias", "te pasaste")
CONFIRM_PHRASE = ("confirmar", "confirmo", "confirmado", "de acuerdo", "procede",
                "factura", "boleta", "dale", "listo", "adelante")
CONFIRM_WORD = ("si", "ya", "ok", "vale")
TRACK_W = ("estado", "donde", "dónde", "track", "seguimiento", "llega", "demora",
           "tarda", "mi pedido", "llego")
# tracking FUERTE: habla de SU pedido, no de demoras genéricas ("cuanto demora?")
TRACK_STRONG = ("mi pedido", "estado", "seguimiento", "track", "llego",
                "me llego", "mi orden", "mi compra")
PAY_W = ("pagar", "pago", "culqi", "yape", "plin", "tarjeta", "efectivo", "voucher",
         "comprobante", "transferencia", "qr")
ADDR_HINT = ("direccion", "jiron", "jr ", "av ", "avenida", "calle", "pasaje",
             "mz ", "lt ", "urbanizacion", "distrito", "referencia")
DELIVERY_W = ("delivery", "llevan", "cobertura", "reparto", "reparten",
              "envian", "atienden", "zona", "zonas", "distritos", "llegan")
OUT_W = ("codigo", "python", "programa", "programar", "tarea", "examen",
         "universidad", "colegio", "clase", "curso", "tesis", "ensayo",
         "java", "javascript", "excel", "matematica")
MODEL_Q = ("que modelo", "que eres", "quien eres", "quienes son", "eres robot",
           "eres ia", "eres inteligencia", "que ia eres", "claude", "chatgpt",
           "big-pickle", "opencode", "que version")
BOTS = {"faro": "FaroBot", "brasa": "BrasaBot", "juana": "JuanaBot"}
QTY_RE = re.compile(r"(\d+)\s*[x×]?\s*")
SPLIT_RE = re.compile(r"\s*(?:\+|&|,|;|\by\b)\s*")
NUMWORDS = {"un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4,
            "cinco": 5, "medio": 0.5, "media": 0.5, "cuarto": 0.25}


def has_any(text: str, words) -> bool:
    return any(w in text for w in words)


def has_word(text: str, words) -> bool:
    # match de palabra completa: "ya" no debe disparar en "yape"
    return any(re.search(r"(^|\s)" + re.escape(w) + r"(\s|$)", text) for w in words)


HALF_HINT = {"medio": "1/2", "media": "1/2", "cuarto": "1/4", "entero": "entero"}


def strip_lead(chunk: str) -> str:
    """Quita verbos/muletas del inicio: 'quiero 2 ceviche' -> '2 ceviche'."""
    changed = True
    while changed:
        changed = False
        for w in LEAD_FILL:
            if chunk == w:
                return ""
            if chunk.startswith(w + " "):
                chunk = chunk[len(w) + 1:].strip()
                changed = True
                break
    return chunk


def menu_text(tenant: str, greet: bool = True) -> str:
    t = data.TENANTS[tenant]
    items = [i for i in data.get_menu(tenant) if i["disponible"]]
    lines = "\n".join(f"{n}. *{i['nombre']}* — S/{i['precio']:.0f}\n   {i['desc']}"
                      for n, i in enumerate(items, 1))
    head = f"{t['saludo']}\n\n" if greet else ""
    return (f"{head}Carta hoy:\n\n{lines}\n\n"
            f"Respóndeme con el número o dime ej: `quiero 2 ceviche + 1 inca`.\n"
            f"También puedes pedir `foto del ceviche` y te la mando.")


def strip_fillers(msg: str) -> str:
    for _ in range(3):
        for f in FILLER:
            if msg == f:
                return ""
            if msg.startswith(f + " ") or msg.startswith(f + ","):
                msg = msg[len(f):].lstrip(" ,").strip()
            if msg.endswith(" " + f) or msg.endswith("," + f):
                msg = msg[: -len(f)].rstrip(" ,").strip()
    return msg


def fmt_cant(c: dict) -> str:
    # "0.5x 1/2 pollo" se lee mal: la porción ya está en el nombre
    if c["cant"] in (0.5, 0.25) and ("1/2" in c["nombre"] or "1/4" in c["nombre"]):
        return f"1x {c['nombre']}"
    return f"{c['cant']:g}x {c['nombre']}"


def cart_summary(tenant: str, cart: list) -> str:
    t = data.TENANTS[tenant]
    total = sum(c["precio"] * c["cant"] for c in cart) + t["delivery"]
    detalle = ", ".join(fmt_cant(c) for c in cart)
    return (f"Anotado: {detalle}.\nSubtotal + delivery S/{t['delivery']:.0f} = "
            f"S/{total:.2f} ({t['tiempo']}).\n\n¿Confirmas? Escribe `confirmar` "
            f"o dime tu dirección.")


def add_to_cart(cart: list, item: dict, cant: float) -> list:
    found = next((c for c in cart if c["id"] == item["id"]), None)
    if found:
        found["cant"] += cant
    else:
        cart.append({"id": item["id"], "nombre": item["nombre"],
                     "precio": item["precio"], "cant": cant})
    return cart


def parse_chunk(tenant: str, chunk: str):
    """Una porción de pedido -> (item, cant) o (None, None)."""
    raw = chunk.strip()
    had_verb = any(raw == w or raw.startswith(w + " ") for w in ORDER_V)
    chunk = strip_lead(raw)
    if not chunk or len(chunk) < 2:
        return None, None
    hint = next((HALF_HINT[w] for w in HALF_HINT if w in chunk.split()), None)
    cant = None
    rest = chunk
    mf = re.match(r"1\s*/\s*(2|4)\b\s*(.*)", chunk)  # "1/4 pollo", "1 / 2 pollo"
    if mf:
        cant = 0.5 if mf.group(1) == "2" else 0.25
        hint = hint or ("1/2" if mf.group(1) == "2" else "1/4")
        rest = mf.group(2).strip()
        rest = strip_lead(rest)
    else:
        m = QTY_RE.match(chunk)
        if m:
            cant = float(m.group(1))
            rest = chunk[m.end():].strip()
            rest = strip_lead(rest)
        else:
            for w, v in NUMWORDS.items():
                if rest == w or rest.startswith(w + " "):
                    cant = float(v)
                    rest = rest[len(w):].strip()
                    rest = strip_lead(rest)
                    break
    hits = data.find_item(tenant, rest) if rest else []
    if not hits:
        return None, None
    item = hits[0]
    if hint:  # "medio pollo" -> prefiere el item "1/2 pollo"
        pref = next((h for h in hits if hint in h["nombre"]), None)
        if pref:
            item = pref
    if cant is None:
        # nombre suelto sin cantidad: solo vale si el chunk trajo verbo de
        # pedido ("quiero ceviche" -> 1x); sin verbo es mención suelta (ficha)
        if not (had_verb and hits):
            return None, None
        cant = 1.0
    if ("1/2" in item["nombre"] or "1/4" in item["nombre"]) and cant in (0.5, 0.25):
        cant = 1.0  # la porción ya es la unidad del item ("1/2 pollo" = 1 pedido)
    return item, min(cant, 10)


def bot_reply(tenant: str, message: str, cart: list) -> dict:
    t = data.TENANTS[tenant]
    raw = message.strip()
    msg = norm(raw)
    msg = strip_fillers(msg) or msg
    cart = cart if cart is not None else []
    is_greeting = len(msg.split()) <= 4 and has_any(msg, GREET)

    # 0) número de carta ("2", "el 3"): ficha del plato n
    mn = re.fullmatch(r"(el|la|él |lo |l |n(?:umero|ro)?\.?)?\s*(\d)\b.*", msg)
    if mn:
        items = [i for i in data.get_menu(tenant) if i["disponible"]]
        n = int(mn.group(2))
        if 1 <= n <= len(items):
            it = items[n - 1]
            return {"reply": (f"*{it['nombre']}* — S/{it['precio']:.0f}\n{it['desc']}.\n"
                              f"¿Lo agrego? Dime ej: `2 {it['nombre'].split()[0].lower()}`"),
                    "cart": cart}

    # 0b) cobertura de delivery ("llevan a miraflores?"). Si habla de SU pedido,
    # cae al tracking de abajo.
    if has_any(msg, DELIVERY_W) and "mi pedido" not in msg and "estado" not in msg:
        return {"reply": (f"Hacemos delivery por S/{t['delivery']:.0f} "
                          f"({t['tiempo']}). ¿A qué distrito te lo llevo? "
                          f"Pásame tu dirección y cerramos."),
                "cart": cart}

    # 0c) identidad: siempre el personaje, jamás el modelo interno
    if has_any(msg, MODEL_Q):
        return {"reply": (f"Soy *{BOTS.get(tenant, 'FaroBot')}*, recepcionista de "
                          f"{t['nombre']}. Te ayudo con la *carta*, tu *pedido* "
                          f"y el *pago*. ¿Qué se te antoja?"),
                "cart": cart}

    # 1) tracking fuerte (habla de su pedido) o demora genérica sin pedido
    if has_any(msg, TRACK_W) and not has_any(msg, ORDER_V):
        if has_any(msg, TRACK_STRONG):
            return {"reply": ("Tu pedido lo ves en el Panel con tu nombre. "
                              "Si ya pagaste, pasa a cocina en segundos. "
                              "¿Me das tu nombre para buscarlo?"),
                    "cart": cart}
        return {"reply": (f"La demora es {t['tiempo']} desde el pago verificado "
                          f"(delivery S/{t['delivery']:.0f}). ¿Te muestro la carta?"),
                "cart": cart}

    # 2) pago directo
    if has_any(msg, PAY_W) and not data.find_item(tenant, msg):
        if not cart:
            return {"reply": ("Aún no tienes pedido. Dime qué quieres "
                              "y luego elegimos Culqi o Yape."),
                    "cart": cart}
        return {"reply": ("Perfecto. Te genero el cobro: elige **Culqi link "
                          "(sandbox)** o **Yape QR**. En el chat verás los botones."),
                "cart": cart, "next": "pago"}

    # 3) confirmar (con o sin dirección). "vale" también es precio:
    # solo cede si hay objetivo de precio real (plato o palabra de carta).
    price_target = has_any(msg, PRICE_Q) and (
        bool(data.find_item(tenant, msg)) or has_any(msg, MENU_W))
    if (has_any(msg, CONFIRM_PHRASE) or has_word(msg, CONFIRM_WORD)
            or has_any(msg, ADDR_HINT)) and not price_target:
        if not cart:
            return {"reply": ("Aún no tienes pedido. Dime qué quieres, "
                              "ej `quiero medio pollo`."),
                    "cart": cart}
        return {"reply": ("Perfecto. Te genero el cobro: elige **Culqi link "
                          "(sandbox)** o **Yape QR**. En el chat verás los botones."),
                "cart": cart, "next": "pago"}

    # 4) pedido: verbo de orden o cantidad + plato (multi-item con + y ,)
    chunks = [c for c in SPLIT_RE.split(msg) if c.strip()]
    order_hits = []
    for ch in chunks:
        item, cant = parse_chunk(tenant, ch)
        if item:
            order_hits.append((item, cant))
        elif has_any(msg, ORDER_V) and not has_any(ch, PRICE_Q):
            # chunk sin cifra ni verbo propio ("una chicha" en "quiero un
            # ceviche y una chicha"): el verbo del mensaje lo cubre. Se excluyen
            # chunks de precio ("y cuanto esta el lomo") para no meterlos al
            # carrito.
            hits = data.find_item(tenant, ch)
            if hits:
                order_hits.append((hits[0], 1.0))
    if order_hits:
        replies = []
        for item, cant in order_hits:
            if not item["disponible"]:
                alts = data.find_item(tenant, item["cat"])
                alt = next((a for a in alts if a["disponible"] and a["id"] != item["id"]), None)
                replies.append(f"{item['nombre']} está agotado hoy." +
                               (f" ¿Te ofrezco {alt['nombre']} S/{alt['precio']:.0f}?" if alt else ""))
                continue
            cart = add_to_cart(cart, item, cant)
        if cart and not replies:
            return {"reply": cart_summary(tenant, cart), "cart": cart}
        if cart and replies:
            return {"reply": " ".join(replies) + "\n\n" + cart_summary(tenant, cart), "cart": cart}
        return {"reply": " ".join(replies) or "Eso se nos acabó hoy. ¿Te muestro la carta?",
                "cart": cart}

    # 5) pregunta de precio sobre un plato ("cuanto esta el lomo?")
    if has_any(msg, PRICE_Q):
        hits = data.find_item(tenant, msg)
        if hits:
            it = hits[0]
            return {"reply": (f"*{it['nombre']}* — S/{it['precio']:.0f}\n{it['desc']}. "
                              f"{'Disponible ahora.' if it['disponible'] else 'Agotado hoy.'}\n"
                              f"¿Lo agrego? Dime ej: `2 {it['nombre'].split()[0].lower()}`"),
                    "cart": cart}

    # 5b) fotos: ahora SÍ enviamos fotos reales (static/img/platos)
    if has_word(msg, PHOTO_W):
        hits = data.find_item(tenant, msg)
        if hits:
            it = hits[0]
            return {"reply": (f"*{it['nombre']}* — S/{it['precio']:.0f}\n{it['desc']}. "
                              f"¿Te anoto uno? Dime ej: `1 {it['nombre'].split()[0].lower()}`"),
                    "cart": cart, "foto": it["foto"]}
        items = [i for i in data.get_menu(tenant) if i["disponible"]][:3]
        sug = ", ".join(f"{n}. {i['nombre']}" for n, i in enumerate(items, 1))
        return {"reply": ("Dime qué plato y te mando su foto con precio. "
                          f"Para empezar: {sug}."),
                "cart": cart}

    # 6) menú / carta / qué hay (sin re-saludar si ya conversa)
    if has_any(msg, MENU_W):
        return {"reply": menu_text(tenant, greet=is_greeting and not cart), "cart": cart}

    # 7) plato mencionado sin cantidad ni pregunta: ficha + oferta
    hits = data.find_item(tenant, msg)
    if hits:
        it = hits[0]
        return {"reply": (f"{it['nombre']} S/{it['precio']:.0f} — {it['desc']} ({it['cat']}). "
                          f"{'Disponible.' if it['disponible'] else 'Agotado hoy.'}\n"
                          f"¿Lo agrego? Ej: `2 {it['nombre'].split()[0].lower()}`"),
                "cart": cart}

    # 8) saludo corto
    if len(msg.split()) <= 3 and has_any(msg, GREET):
        return {"reply": menu_text(tenant), "cart": cart}

    # 8b) gracias: calidez en una línea
    if has_any(msg, THANKS):
        return {"reply": ("De nada, para eso estoy. ¿Seguimos con tu pedido "
                          "o te muestro la carta?"),
                "cart": cart}

    # 8c) fuera de rubro ("un codigo de python"): humor + carta, nunca código
    if has_any(msg, OUT_W):
        return {"reply": ("Jaja, de eso no sé nada — lo mío es la comida.\n\n"
                          + menu_text(tenant, greet=False)),
                "cart": cart}

    # 9) fallback: nunca vacío; muestra la carta numerada para cerrar
    return {"reply": ("No me quedó claro, pero te ayudo con esto:\n\n"
                      + menu_text(tenant, greet=False)),
            "cart": cart, "fallback": True}


def calc_total(tenant: str, items: list) -> float:
    d = t_delivery(tenant)
    menu = {i["id"]: i for i in data.MENUS[tenant]}
    sub = sum(menu[i["id"]]["precio"] * i["cant"] for i in items if i["id"] in menu)
    return round(sub + d, 2)


def t_delivery(tenant: str) -> float:
    return data.TENANTS[tenant]["delivery"]


def culqi_link(tenant: str, order_id: str, monto: float) -> dict:
    # sandbox: link falso, reference_id único (patrón Meta order_details)
    ref = f"{tenant}-{order_id[:8]}-{uuid.uuid4().hex[:6]}"
    com = round(monto * data.TENANTS[tenant]["culqi_comision"], 2)
    return {"reference_id": ref, "url": f"https://sandbox.culqi.test/pay/{ref}",
            "monto": monto, "comision_est": com,
            "nota": "SANDBOX, sin dinero real. Máx Yape real S/2000."}


def yape_verify(monto_esperado: float, monto_foto: float) -> dict:
    # anti Yape-falso: match exacto + ventana. Foto nunca = pagado solo.
    try:
        mf = float(monto_foto)
    except Exception:
        return {"ok": False, "estado": "pendiente_verificar",
                "motivo": "monto ilegible, derivar a humano"}
    if abs(mf - monto_esperado) < 0.01:
        return {"ok": True, "estado": "pagado_yape",
                "motivo": "match exacto + revisión humana OK (demo)"}
    return {"ok": False, "estado": "pendiente_verificar",
            "motivo": (f"monto foto S/{mf} != esperado S/{monto_esperado}. "
                       f"Posible Yape falso, no pasar a cocina.")}
