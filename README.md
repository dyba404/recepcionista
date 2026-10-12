# SaaS Recepcionista WhatsApp — Mockup + Prototipo funcional
Foco comidas (3 locales demo), escalable a citas. Base conceptual: AgentKit + chatalog + GinoRobla.

## Correr
```powershell
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```
Abrir http://127.0.0.1:8000

## Estructura
```
backend/
  app/               FastAPI: main, brain, logic, store, data
  tests/             pytest (batería E2E de la API)
  sandbox/           workspace de opencode (contenido transitorio)
  requirements.txt
  pyproject.toml     # ruff + pytest configurados
frontend/            React + Vite + shadcn (base shadcn-admin) — en construcción
static/              vistas legacy servidas por el backend hasta paridad
docs/                DESIGN.md, PRODUCT.md, adr/
openspec/            specs vigentes y changes en curso
.opencode/  .zcode/  skills/commands compartidas (skills por junction)
```

## Frontend
En construcción (base shadcn-admin). Comandos previstos:
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 con proxy /api -> :8000
```

## Pago real (Culqi sandbox, opcional)
Sin llaves, el botón "Culqi (SIMULADO)" marca pagado a propósito para demostrar la regla
anti-fraude. Con llaves de prueba, el botón "Pagar con tarjeta" crea un cargo REAL en
Culqi sandbox (tarjeta de test 4111 1111 1111 1111) verificado server-side:
```powershell
$env:CULQI_PUBLIC_KEY="pk_test_..."
$env:CULQI_SECRET_KEY="sk_test_..."
python -m uvicorn backend.app.main:app --port 8000
```
El QR de Yape es demo escaneable (sandbox); la verificación sigue siendo monto exacto.

## Vistas (mockup flujo completo, servidas desde static/)
* `/` landing + selector 3 locales
* `/chat` simulador WhatsApp cliente (RAG carta, carrito, pago)
* `/panel` Kanban dueño (Nuevo/Confirmado/Cocina/Delivery)
* `/cocina` KDS tablet (Preparando/Listo)
* `/menu` admin carta (toggle, precio)

## API prototipo
* `GET /api/tenants` `GET /api/menu?tenant=faro`
* `POST /api/chat` {tenant, customer, message} -> {reply, cart, order_id}
* `GET /api/track?tenant=&cliente=` estado real de los pedidos por nombre
* `POST /api/orders` `GET /api/orders?tenant=` `PATCH /api/orders/{id}`
* `POST /api/payments/culqi/link` (sandbox, no dinero real)
* `POST /api/payments/culqi/webhook` {reference_id} -> marca PAID server-side
* `POST /api/payments/yape` {order_id, monto_foto, monto_real} -> PAID o pendiente_verificar (anti Yape-falso)
* `POST /api/demo/reset` recarga seed

## Reglas (papers)
* Screenshot nunca = pagado. Solo webhook verificado o match exacto Yape.
* RAG híbrido simple: keyword + categoría, nunca inventa precio (fuente menu.yaml en `backend/app/data.py`).
* Cerebro híbrido (task-oriented dialogue): NLU determinista dueño del estado;
  el LLM (opencode, muse-spark pineado) solo redacta lo que el NLU no clasifica.
* Dirección real: el chat la captura y queda en el pedido (visible en el Kanban).
* Tracking por nombre: el cliente pregunta y recibe estado/pago/total de verdad.
* Carta admin valida precios (0–9999) y reporta errores reales.
* 3 locales: faro (cevichería), brasa (pollería), juana (menú criollo).
