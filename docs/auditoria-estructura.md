# Auditoría de estructura — qué falta y qué está a medias (2026-10-12)

Honesto y contra el código real. Ordenado por severidad para el SaaS.

## 1. Módulos de conexión (el patrón "cuenta conectada por local")
| Módulo | Estado | Falta |
|---|---|---|
| **Culqi** | 🟡 a medias | Llaves env-globales (no por local), sin wizard, sin validación, **checkout real culqi.js nunca migrado a React** (solo botón SIMULADO). → change `pasarela-culqi` (en curso) |
| **Yape** | 🟡 demo | El "QR" es una URL falsa del seed. Real: el dueño sube la **imagen de su QR real** por local; verificación sigue siendo monto-exacto + humano. Falta upload/almacenamiento del QR. |
| **WhatsApp** | 🟢 conector listo | Producción: número propio (no test), plantillas aprobadas, firma HMAC del GET (solo POST tiene), statuses no persistidos (entregado/leído). |

## 2. Spaghetti estructural (deuda reconocida)
1. **`main.py` monolito** (~180 líneas con todos los routers de tenants/chat/orders/payments/track pegados) — el plan decía capas `api/`, `core/`, `schemas/`; solo whatsapp/inbox tienen router propio. Falta: partir routers por recurso + schemas pydantic centralizados.
2. **Espejo write-through** (persist.py): pragmático pero es una segunda fuente de verdad. El paso limpio: acceso nativo a la BD desde la capa de dominio (con tests de paridad). No urgente, documentado.
3. **`static/` legacy sigue servido** por FastAPI (5 vistas viejas + rutas /chat /panel…). Ya hay paridad en React → borrar rutas y carpetas; el simulador real es `/cliente`.
4. **Componentes duplicados**: burbujas en features/cliente vs features/inbox (dos parsers md distintos). Unificar en lib/ o components/chat/.
5. **Seeds mezclados con código**: data.py es fuente de datos Y seed Y lógica. Separar seed/ (json o tabla).

## 3. Producto SaaS — lo que un cliente de verdad esperaría y NO existe
1. **Onboarding de locales**: los 3 tenants están hardcodeados. No existe "crear mi local" (nombre, distrito, delivery, carta) ni un dueño que se registre. Ese es el vacío principal para ser un SaaS multi-tenant real.
2. **Gestión de equipo**: no hay endpoint de usuarios → el dropdown "Asignar" del inbox usa los asignados existentes + el usuario actual. Falta CRUD de staff por local (invitar/rol).
3. **Ledger de pagos**: los pagos viven como campos del pedido (pago, culqi_ref). Un SaaS de cobros necesita tabla `payment` (intento, gateway, referencia, monto, comisión, resultado, ts) — hoy no hay historial ni reintentos.
4. **Registro de dueños**: endpoint /api/auth/register existe pero sin UI ni flujo (verificación de email, selección de plan).
5. **Métricas**: los KPIs del dashboard se calculan al vuelo sobre los pedidos en memoria; sin métricas históricas ni reportes exportables.
6. **Notificaciones**: nada avisa al dueño (nuevo pedido, fraude detectado, mensaje sin responder).

## 4. Operaciones / producción
1. **Deploy no resuelto**: `frontend/dist` se construye pero el backend NO lo sirve; no hay Dockerfile/compose del stack completo; el túnel apunta al dev server en el puerto 8000 del host.
2. **Migraciones**: tablas con `create_all` — un cambio de esquema en SQLite existente se rompe; falta alembic (o migraciones manuales documentadas).
3. **`.env.example`** no existe (documentación de variables); `docs/rotacion-secretos.md` cubre rotación pero no inventario.
4. **CI**: falta eslint en el job de frontend y no hay gate de cobertura.
5. **Secretos en BD pendiente de cifrar** (cuando entren llaves Culqi por local).

## Orden recomendado
1. `pasarela-culqi` (en curso) — cerrar el módulo de cobros.
2. Routers/schemas de main.py + borrar static/ (spaghetti barato de matar).
3. Onboarding de locales + CRUD staff (el SaaS real).
4. Ledger de pagos + QR Yape real por local.
5. Deploy: FastAPI sirviendo dist + docker-compose + alembic.
