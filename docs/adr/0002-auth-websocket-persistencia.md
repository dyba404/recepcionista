# ADR 0002 — Auth real, WebSocket y alcance de persistencia

Fecha: 2026-10-11 · Estado: aceptada · Decide: dueño (D1 auth real, D2 kanban
híbrido, D3 WebSocket, "quiero algo serio, no un mockup")

## Decisiones
1. **Auth**: login email+password con JWT (HS256, exp 24h, SECRET por env).
   Hash pbkdf2_sha256 (stdlib — cero dependencias nativas en Windows). Endpoints:
   `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
   Usuarios PERSISTENTES en SQLite (`backend/app.db`, SQLModel). Seed: admin de
   demo `admin@demo.pe / demo1234` (rol owner, tenant faro).
2. **Protección**: pública la parte "cliente" (equivale a WhatsApp en producción):
   `/api/chat`, `/api/track`, `POST /api/orders`, `/api/payments/*`, `/api/tenants`,
   `/api/menu` (lectura). Protegida la parte "dueño": `GET/PATCH /api/orders`,
   `POST /api/menu/toggle`, `POST /api/demo/reset`, (futuras settings).
3. **Realtime**: `WS /ws/orders?token=<jwt>` — el backend emite
   `{"event":"order.created|order.updated","order":{...}}` en cada cambio de pedido
   (creación, avance de estado, pagos). Fin del polling de 4s en panel/cocina
   (fallback: refetch si el WS cae).
4. **Kanban híbrido** (D2): drag&drop con **dnd-kit** Y botones de avance; avance
   optimista con rollback + toast explicando el 400 anti-fraude.
5. **Alcance de persistencia (esta fase)**: SQLite SOLO para usuarios (lo que hace
   al SaaS "real": sesión que sobrevive reinicios). Pedidos/carta siguen en memoria
   por decisión de sandbox (PRODUCT.md) — migración completa a SQLite = change
   posterior.
6. **Transición**: las vistas legacy de dueño (panel/cocina/menu estáticos) quedan
   degradadas por el 401 — se reemplazan por las páginas React en este mismo
   change. El chat simulador del cliente (legacy /chat) sigue público.

## Consecuencias
+ Sesión real, realtime, y shell de SaaS con guardias de ruta; base para
  multi-tenant con roles (owner/staff) ya modelado.
− El login demo (`admin@demo.pe/demo1234`) es de sandbox; producción exigirá
  registro verificado y refresh tokens (change posterior).
− Los tests existentes de endpoints protegidos se actualizan a flujo con token.
