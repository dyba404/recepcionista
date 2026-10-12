"""App FastAPI: SOLO creación + arranque + routers (saas-cola-2 refactor).

El spaghetti de rutas vivió aquí hasta el change saas-cola-2; ahora cada
dominio es su módulo: auth, ws, modules, inbox, whatsapp, payments (cuenta
Culqi + flujos + ledger), orders, chat, menu, tenants (locales + QR Yape),
staff y demo. Las vistas HTML legacy (/, /chat, /panel, /cocina, /menu)
MUEREN: el frontend React (../frontend/dist) se sirve aquí cuando existe
su build, con fallback SPA a index.html para los deep-links del router.

Arranque (import): app/__init__ carga backend/.env (dotenv), db crea el
engine, persist.hydrate() siembra/carga locales+pedidos+carta y seed.run()
deja los usuarios demo y los módulos ON (ambos idempotentes).
"""
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import (  # noqa: F401 — import dispara los routers de dominio
    bot,
    chat,
    demo,
    horarios,
    inbox,
    kb,
    menu,
    modules,
    orders,
    payments,
    persist,
    seed,
    staff,
    tenants,
    whatsapp,
    ws,
)
from .auth import router as auth_router

app = FastAPI(title="SaaS Recepcionista WhatsApp — prototipo")
BASE = os.path.dirname(os.path.dirname(__file__))  # backend/
ROOT = os.path.dirname(BASE)  # raíz del repo: static/ (solo img/), frontend/

persist.hydrate()  # espejo: locales/pedidos/carta siembran BD vacía y se cargan de ella
seed.run()  # usuarios demo + módulos ON (idempotente)

app.include_router(auth_router)
app.include_router(ws.router)
app.include_router(modules.router)
app.include_router(inbox.router)
app.include_router(whatsapp.router)
app.include_router(whatsapp.webhook_router)
app.include_router(payments.router)  # cuenta Culqi, cobros y ledger
app.include_router(orders.router)
app.include_router(chat.router)
app.include_router(menu.router)
app.include_router(tenants.router)
app.include_router(staff.router)
app.include_router(bot.router)  # Asistente: GET/PUT/PATCH /api/botconfig
app.include_router(kb.router)  # base de conocimiento del local
app.include_router(horarios.router)  # horarios de atención del local
app.include_router(demo.router)

# estáticos del repo: ya SOLO sirven las fotos de platos (static/img);
# las vistas HTML legacy murieron con el frontend React.
app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "static")), name="static")

# ── frontend React compilado (producción): ../frontend/dist en "/" ──
# En dev no existe el build y el cliente de vite (:5173) usa /api de acá.
DIST = Path(ROOT) / "frontend" / "dist"
if DIST.is_dir():
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Fallback SPA: deep-links del router al index.html de React. Si la
        ruta es un archivo real del build (assets/…), se sirve ese archivo."""
        if full_path.startswith(("api/", "static/", "ws")):
            raise HTTPException(404, "No encontrado")
        f = DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html", media_type="text/html")

    # AL FINAL: assets del build y métodos no-GET; los GET ya los atajo arriba.
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
