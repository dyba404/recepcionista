"""Cerebro híbrido del chat (patrón task-oriented dialogue, cf. Kulkarni 2025).

1. NLU determinista (logic.py) clasifica intents y ES DUEÑO DEL ESTADO:
   carta, carrito, cobro, tracking, identidad, fuera de rubro. Responde en 0 ms.
2. El LLM (opencode run) solo redacta lo que el NLU no clasificó (long tail:
   alergias, fiestas, caprichos), con la carta real como contexto en el prompt.
   Nunca marca pagos ni cocina: el parser y los guards filtran su salida.
3. Si el LLM narra, toca archivos o falla: un reintento y luego texto
   determinista, para que el chat nunca se cuelgue.
"""
import json
import os
import re
import shutil
import subprocess
import unicodedata

from . import bot, data, horarios, kb, logic, store

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANDBOX = os.path.join(BASE, "sandbox")

# pineado: el default de opencode puede cambiar o ser de pago bajo nosotros
MODEL = os.environ.get("OPENCODE_MODEL", "opencode/muse-spark-1.3-contributor-free")
VARIANT = os.environ.get("OPENCODE_VARIANT", "xhigh")
TIMEOUT = int(os.environ.get("OPENCODE_TIMEOUT", "30"))


def _find_opencode() -> str:
    """Binario real de opencode. CRITICO: no pasar por `cmd /c` — cmd corta el
    argv en cada salto de linea y el LLM recibe solo la primera linea (la carta
    llega rota y el modelo 'narra' pidiendola). Directo al .exe, argv intacto."""
    exe = os.environ.get("OPENCODE_EXE")
    if exe and os.path.exists(exe):
        return exe
    cand = os.path.join(os.environ.get("APPDATA", ""), "npm", "node_modules",
                        "opencode-ai", "bin", "opencode.exe")
    if os.path.exists(cand):
        return cand
    return "opencode"  # fallback PATH (shim: prompts multilinea se cortan)


# tono del Asistente (BotConfig) → la línea que lo describe en el prompt.
# Las REGLAS de abajo NO son configurables a propósito: si el dueño pudiera
# reescribirlas, una instrucción descuidada desarmaría la verificación de
# pagos o el "sin cocina". Las instrucciones_extra SE AÑADEN después de ellas,
# marcadas "sin contradecir las REGLAS" (patrón asistente: campos seguros).
TONOS = {"cercano": "cercano, como caserito peruano",
         "formal": "formal pero cálido, sin jerga",
         "divertido": "con humor ligero, sin payasadas"}


def context_block(tenant: str) -> str:
    t = data.TENANTS[tenant]
    cfg = bot.bot_config(tenant)
    nombre = cfg["nombre_bot"] or bot.DEFAULT_NOMBRES.get(tenant, "FaroBot")
    tono = TONOS.get(cfg["tono"], TONOS["cercano"])
    lines = []
    for i in data.MENUS.get(tenant, []):
        disp = "AGOTADO" if logic.agotado(i) else "disponible"
        lines.append(f"- [{i['id']}] {i['nombre']} S/{i['precio']:.0f} ({disp}). {i['desc']}")
    menu = "\n".join(lines)
    # KB activa del local (carta-inventario-bot): horarios, ubicación, promos.
    # Solo activas, sin tope extra — el local es chico y el prompt aguanta.
    kbl = [f"- {e.tema}: {e.contenido}" for e in kb.kb_entries(tenant)]
    kb_block = ("\n- INFORMACION DEL LOCAL:\n" + "\n".join(kbl)) if kbl else ""
    extras = cfg["instrucciones_extra"].strip()
    extra_block = (f"""

INSTRUCCIONES DEL DUEÑO (extras, sin contradecir las REGLAS):
{extras}""" if extras else "")
    return f"""Eres {nombre}, el recepcionista WhatsApp de "{t['nombre']}" ({t['distrito']}, Peru).
Tu trato es {tono}. Te sabes tu carta DE MEMORIA (esta abajo). No busques
archivos, no uses herramientas, no narres lo que haces: tu unica salida es el
mensaje al cliente, 1 a 4 lineas, espanol peruano calido, con tildes
correctas. Solo atiendes carta, pedido, pago y estado del pedido.

DATOS REALES (unica fuente de verdad, no inventes nada fuera de esto):
- Delivery S/{t['delivery']:.0f}. Tiempo estimado: {t['tiempo']}.
- Cobro: link Culqi (sandbox) o Yape QR del local. La app genera los botones;
  tu solo anuncia la eleccion cuando el pedido este confirmado.
- CARTA:
{menu}{kb_block}

REGLAS (cortas, todas obligatorias):
1. Precios y platos SOLO de la carta de arriba; horarios, ubicacion y promos
   SOLO de INFORMACION DEL LOCAL (si no aparece ahi, no lo sabes: no lo
   inventes). Nunca reservas.
2. Ante saludo o "que hay / menu / carta": saluda en 1 linea Y muestra la lista
   numerada completa en el mismo mensaje. Nunca preguntes a que se refieren.
3. Si CONFIRMA (confirmar, ok, dale, o da direccion): da el TOTAL y anuncia
   Culqi-link / Yape-QR. JAMAS hables de cocina, preparacion o reparto.
4. Fuera de rubro (codigo, tareas): 1 linea con humor ("lo mio es la comida")
   + la lista numerada. Nunca hagas ni preguntes por esa tarea.
5. Nunca menciones tu modelo interno ni que eres IA: siempre eres {nombre}.
   Nunca crees archivos ni escribas codigo.{extra_block}
"""


def _run_opencode(message: str, session: str | None) -> tuple[str, str | None]:
    # Agente default en sandbox aislado. (El agente 'camarero' sin tools existe
    # en .opencode/agents, pero el free tier lo bloquea desde CLI con 403.)
    cmd = [_find_opencode(), "run", "--dir", SANDBOX, "--format", "json",
           "-m", MODEL, "--variant", VARIANT]
    if session:
        cmd += ["-s", session]
    cmd += [message]
    proc = subprocess.run(cmd, capture_output=True, text=False, timeout=TIMEOUT)
    raw_out = proc.stdout or b""
    try:
        out = raw_out.decode("utf-8").strip()
    except UnicodeDecodeError:
        out = raw_out.decode("cp1252").strip()
    if not out:
        err = b""
        try:
            err = (proc.stderr or b"").decode("utf-8", errors="replace")
        except Exception:
            err = ""
        raise RuntimeError(f"opencode vacio: {err[-300:]}")
    texts, sid, err_msg = [], session, ""
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        sid = sid or ev.get("sessionID")
        if ev.get("type") == "text":
            part = ev.get("part", {})
            if isinstance(part.get("text"), str):
                texts.append(part["text"])
        elif ev.get("type") == "error":
            err_msg = str((ev.get("error") or {}).get("data", {}).get("message")
                          or ev.get("error"))[:200]
    # El modelo puede emitir VARIOS segmentos de texto (un borrador que narra y
    # la respuesta final). Solo el ULTIMO es el mensaje para el cliente: unirlos
    # todos produce el clasico "¡Hola! Te muestro...¡Hola! Soy FaroBot...".
    reply = (texts[-1] if texts else "").strip()
    if not reply:
        raise RuntimeError(f"opencode sin texto (api: {err_msg or '?'})")
    return reply, sid


def _flat(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


CARRITO_RE = re.compile(r"^\s*CARRITO:\s*(\[.*\])\s*$", re.MULTILINE)
META_RE = re.compile(
    r"reviso|revisando|examinando|asumo el rol|un momento|dame el mensaje|"
    r"pega el mensaje|como modelo|soy (un|una) (ia|asistente|modelo)|"
    r"puedo ayudarte\?.*tarea|voy a (revisar|ver|atender)|^\s*atiendo\b|"
    r"pasame|pasame|enviame|necesito (la|el|que)|para atender|"
    r"activando|preparo|listo, ya estoy como|falta informaci|necesito.{0,40}"
    r"(mensaje|carta|menu)|pasame ambos|pasa?me (ambos|el mensaje|la carta)|"
    r"cual es el mensaje|que mensaje|redacto la respuesta|no encuentro archivos|"
    r"directorio sandbox|no hay archivos|lei?do el archivo|voy a (buscar|leer|"
    r"revisar|ver)|trabajando en|entendido, |de acuerdo, |enviame el mensaje|"
    r"si aplica|aqui esta|aquí está|entendido\.|cual es (la carta|el mensaje)|"
    r"que (carta|mensaje|informacion) debo|como puedo ayudarte hoy\?",
    re.IGNORECASE)


VIOL_RE = re.compile(
    r"en camino|cocina|preparaci|repartidor|saliendo|ya esta listo|"
    r"reserva|horario|efectivo|tarjeta directa|"
    r"big-pickle|opencode|claude|anthropic|soy un modelo|soy una ia|"
    r"como ia|modelo de lenguaje|juego\.html|doble clic|guarde el|cree el|"
    r"he creado|```",
    re.IGNORECASE)


def _sandbox_snapshot():
    try:
        return set(os.listdir(SANDBOX))
    except Exception:
        return set()


def _sandbox_clean(before) -> bool:
    """Borra archivos que el LLM haya creado en el sandbox. True si limpio algo."""
    try:
        new = set(os.listdir(SANDBOX)) - before
    except Exception:
        return False
    for n in new:
        p = os.path.join(SANDBOX, n)
        try:
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                os.remove(p)
        except Exception:
            pass
    return bool(new)


def parse_machine(reply: str):
    """Separa (mensaje_limpio, carrito|None, pagar:bool)."""
    pagar = "[[PAGAR]]" in reply
    reply = reply.replace("[[PAGAR]]", "")
    cart = None
    m = CARRITO_RE.search(reply)
    if m:
        try:
            items = json.loads(m.group(1))
            cart = [{"id": str(x["id"]), "cant": min(float(x.get("cant", 1)), 10)}
                    for x in items if isinstance(x, dict) and "id" in x]
        except Exception:
            cart = None
        reply = CARRITO_RE.sub("", reply)
    return reply.strip(), cart, pagar


PRIME = ("Cada mensaje mio es de un cliente real. Tu salida ES el mensaje de WhatsApp "
         "para el cliente: escribelo ya, sin preambulos, sin decir que vas a buscar o "
         "revisar nada; la carta ya esta en este mensaje.")


def _cart_note(cart: list) -> str:
    if not cart:
        return ""
    detalle = ", ".join(f"{c['cant']:g}x {c['nombre']}" for c in cart)
    return f" (su pedido hasta ahora: {detalle})"


def _looks_like_address(tenant: str, raw: str) -> bool:
    """Una dirección real: palabra de dirección o texto con número, largo y
    que no sea un plato de la carta."""
    if not raw or len(raw.strip()) < 6:
        return False
    msg = logic.norm(raw)
    if logic.has_any(msg, logic.ADDR_HINT):
        return True
    if re.search(r"\d", raw) and len(raw.strip()) >= 8 and not data.find_item(tenant, msg):
        return True
    return False


def _pago_reply(tenant: str, cart: list, direccion: str) -> dict:
    return {"reply": ("Perfecto. Te genero el cobro: elige **Culqi link "
                      "(sandbox)** o **Yape QR**. En el chat verás los botones."),
            "cart": cart, "next": "pago", "direccion": direccion}


def track_reply(tenant: str, customer: str, cart: list) -> dict:
    """Estado real del pedido, por el nombre de la conversación. 0 ms."""
    pedidos = store.track_orders(tenant, customer)
    if not pedidos:
        return {"reply": ("No encuentro un pedido con ese nombre en este local. "
                          "¿Con qué nombre te anotaste? (cámbialo aquí arriba "
                          "y búscalo de nuevo)"),
                "cart": cart}
    t = data.TENANTS[tenant]
    lines = []
    for o in pedidos[:3]:
        estado = o["estado"].replace("_", " ")
        pago = o["pago"].replace("_", " ")
        marca = "✓" if o["pago"].startswith("pagado") else ""
        lines.append(f"{o['id']} · {estado} · {pago} {marca} — S/{o['total']:.2f}")
    ultimo = pedidos[0]
    if ultimo["estado"] == "entregado":
        paso = "¡Ya lo entregaron! Buen provecho."
    elif not ultimo["pago"].startswith("pagado"):
        paso = "En cuanto verifiquemos el pago, arranca todo."
    else:
        paso = f"Va directo: {t['tiempo']} desde el pago."
    return {"reply": ("Tu pedido:\n" + "\n".join(lines) + "\n\n" + paso),
            "cart": cart}


# ── gates de horario/pausa (change horarios-pausa-notif-perfil) ─

# Pausa total (contrato B, verbatim): ni NLU de pedido ni KB ni LLM. El
# mensaje del cliente SÍ queda guardado + unread: eso lo hace siempre
# whatsapp.process_incoming (el punto único); aquí solo cambia la respuesta.
PAUSA_REPLY = ("Ahora te está atendiendo el equipo del local. "
               "Déjanos tu mensaje y te respondemos en breve.")


def _saludo(msg: str) -> bool:
    """Saludo corto, el mismo criterio del NLU (len<=4 + palabra de GREET)."""
    return len(msg.split()) <= 4 and logic.has_any(msg, logic.GREET)


def _intenta_pedido(msg: str, cart: list, st: dict) -> bool:
    """¿El mensaje es de PEDIDO? (contrato A, clasificación textual): ORDER_V
    en el texto ("quiero 2 ceviche"), confirmar/pagar CON carrito abierto —
    incluida una dirección, que el NLU toma como confirmación de pedido — o el
    flujo de dirección pendiente (lo que sigue ES la dirección del pedido).
    "menu"/fotos/tracking/KB no llevan ninguna de esas → responden igual
    abierto o cerrado; la dirección DEL LOCAL es pregunta de KB, no pedido."""
    if st.get("esperando") == "direccion":
        return True
    if logic.has_any(msg, logic.ORDER_V):
        return True
    if cart:
        if (logic.has_any(msg, logic.CONFIRM_PHRASE)
                or logic.has_word(msg, logic.CONFIRM_WORD)
                or logic.has_any(msg, logic.PAY_W)):
            return True
        if logic.has_any(msg, logic.ADDR_HINT) and logic.kb_intent(msg) is None:
            return True
    return False


def _cerrado_pedido_reply(mensaje_estado: str, cart: list) -> dict:
    """Respuesta fija honesta del contrato A: NUNCA toma el pedido cerrado;
    ofrece la carta y el mensaje. El carrito vuelve intacto."""
    return {"reply": (f"Estamos cerrados. {mensaje_estado}. "
                      "Puedo mostrarte la carta o tomar tu mensaje."),
            "cart": cart}


def reply(tenant: str, customer: str, message: str, cart: list) -> dict:
    """NLU determinista primero (0 ms); LLM solo para el long tail."""
    cart = cart or []
    raw = message.strip()
    _msg = logic.norm(raw)
    st = store.client_state(tenant, customer)

    # 0) PAUSA total del bot (contrato B): antes de TODO — ni flujo de
    # dirección, ni tracking, ni KB, ni NLU, ni LLM. Carrito intacto.
    if bot.bot_pausado(tenant):
        return {"reply": PAUSA_REPLY, "cart": cart}

    # 0b) GATE de cerrado (contrato A): ANTES del NLU de pedido. El tracking
    # (paso 2) y la carta viven igual abierto o cerrado — este gate solo
    # intercepta mensajes de PEDIDO (clasificación textual, ver helper). El
    # pedido en curso muere cerrado: el flujo de dirección se limpia para que
    # el "Puedo mostrarte la carta…" de la respuesta sea de verdad.
    abierto, mensaje_estado = horarios.estado_local(tenant)
    if not abierto and _intenta_pedido(_msg, cart, st):
        if st.get("esperando"):
            st["esperando"] = None
        return _cerrado_pedido_reply(mensaje_estado, cart)

    # 1) dirección pendiente: el texto libre que sigue ES la dirección
    if st.get("esperando") == "direccion":
        if _looks_like_address(tenant, raw):
            st["direccion"] = raw
            st["esperando"] = None
            return _pago_reply(tenant, cart, st["direccion"])
        # no parece dirección: dejar que el NLU atienda lo que sea
        st["esperando"] = None

    # 2) tracking determinista con el nombre de la conversación. Solo si el
    # cliente TIENE pedidos o habla de SU pedido: "cuanto demora?" sin pedidos
    # es pregunta de tiempos, no tracking (lo atiende el NLU abajo). Las
    # preguntas de ubicación ("donde estan ubicados") llevan "donde" pero son
    # de la KB: se excluyen aquí igual que en el NLU (kb_intent).
    if (logic.has_any(_msg, logic.TRACK_W)
            and not logic.has_any(_msg, logic.ORDER_V)
            and logic.kb_intent(_msg) is None):
        if store.track_orders(tenant, customer) or logic.has_any(_msg, logic.TRACK_STRONG):
            return track_reply(tenant, customer, cart)

    # 3) NLU determinista, dueño del estado
    state = logic.bot_reply(tenant, raw, [dict(c) for c in cart])

    # 4) al confirmar, capturar dirección REAL (nunca 'Demo 123')
    if state.get("next") == "pago" and state.get("cart"):
        if _looks_like_address(tenant, raw):
            st["direccion"] = raw
            st["esperando"] = None
        if not st.get("direccion"):
            st["esperando"] = "direccion"
            return {"reply": ("¡Va! ¿A qué dirección te lo llevamos? "
                              "(calle y número, ej: Av Encalada 123)"),
                    "cart": state["cart"]}
        return _pago_reply(tenant, state["cart"], st["direccion"])

    # 5) lo que el NLU sí entendió, sale sin tocar el LLM. Cerrado + saludo:
    # el estado encabeza la respuesta ("Estamos cerrados — abrimos a las…");
    # el resto de la carta responde igual abierto o cerrado (contrato A).
    if not state.get("fallback"):
        if not abierto and _saludo(_msg):
            cuando = horarios.abrimos_en(tenant)
            estado_linea = ("Estamos cerrados — " + cuando) if cuando \
                else "Estamos cerrados"
            state["reply"] = estado_linea + "\n\n" + state["reply"]
        if st.get("direccion"):
            state["direccion"] = st["direccion"]
        return state

    # 6) long tail → LLM, con guardas
    return _llm_reply(tenant, customer, raw, cart, state)


def _llm_prompt(tenant: str, message: str, cart: list, strict: bool) -> str:
    extra = (" IMPORTANTE: tu primera palabra ya es el mensaje al cliente."
             if strict else "")
    return (context_block(tenant) + "\n\n" + PRIME + extra
            + "\n\nResponde UNICAMENTE con el mensaje de WhatsApp para el cliente "
              "(1 a 4 lineas, sin narrar nada):\n\n"
              + f"Cliente por WhatsApp: {message}{_cart_note(cart)}\n"
              + f"Mensaje de {bot.nombre_bot(tenant)}:")


def _llm_reply(tenant: str, customer: str, message: str, cart: list, state: dict) -> dict:
    # Stateless: cada mensaje lleva su contexto completo. La continuacion de
    # sesion (-s) resulto fragil (timeouts del free tier); el estado de la
    # conversacion lo tiene logic/store, no el modelo.
    before = _sandbox_snapshot()
    for attempt in (1, 2):
        try:
            raw_out, _sid = _run_opencode(
                _llm_prompt(tenant, message, cart, strict=attempt == 2), None)
        except Exception:
            return state
        if META_RE.search(_flat(raw_out)):
            continue  # narró: segundo intento con la instruccion estricta
        text, _, _ = parse_machine(raw_out)
        if not text:
            continue
        if _sandbox_clean(before):
            # el LLM toco archivos: se borraron y se descarta su texto
            return state
        if VIOL_RE.search(_flat(text)):
            # prometio cocina/camino/reservas o entrego codigo: determinista
            return state
        result = {"reply": text, "cart": state["cart"]}
        st = store.client_state(tenant, customer)
        if st.get("direccion"):
            result["direccion"] = st["direccion"]
        if state.get("next") == "pago" and state["cart"]:
            result["next"] = "pago"
        return result
    return state
