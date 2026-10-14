# Mapeo frontend — 5 superficies SaaS sobre el template React

> Base: template `satnaing/shadcn-admin` ya clonado en `frontend/`.
> Convenciones del template que se respetan en todo el doc:
> - Rutas file-based TanStack Router en `frontend/src/routes/`:
>   `/_authenticated/<superficie>/index.tsx` → `createFileRoute('/_authenticated/<superficie>/')`.
> - Lógica UI en `frontend/src/features/<superficie>/` (`index.tsx` + `components/` + `data/` + `hooks/`).
> - shadcn en `frontend/src/components/ui/` (button, card, badge, table, skeleton, alert, dialog, select, avatar, scroll-area, sonner…).
> - Shell compartido: `Header` + `Main` + `Search` + `ThemeSwitch` + `ProfileDropdown` (`features/carta`, `features/tasks`, `features/dashboard` lo usan igual).
> - Datos: TanStack Query + `axios` (patrón ya probado en `features/carta/index.tsx`), validación de search params con `zod` (`routes/_authenticated/tasks/index.tsx`), toasts con `sonner`.
> - Nav: alta en `frontend/src/components/layout/data/sidebar-data.ts` (`navGroups` → General).
>
> Requisitos de cada superficie: 5 rutas (mundo Brasa, polling con diff), pedidos con ciclo
> nuevo→confirmado→cocina→delivery→entregado (anti Yape-falso 400, Kanban con diff por columna),
> KDS de cocina (cola confirmado/cocina, un tap avanza, tipografía grande), chat de atención
> (NLU + `POST /api/chat`) y pagos (paybox, QR Yape, Culqi link/webhook/charge). El detalle del
> dominio vive en `docs/DESIGN.md` y `docs/PRODUCT.md`.
> Páginas que ya trae el template en `frontend/src/routes/_authenticated/`: `/` (Dashboard), `/tasks`, `/apps`, `/chats` (inbox genérico con `convo.json` fake), `/users`, `/carta`, `/settings/*`, `/errors/*`, `/help-center`.

---

## 1. Locales (landing 3 tenants)

Prototipo actual: `/` (`static/index.html`) con titular editorial, how-to 4 pasos, botón "Recargar demo" y 3 tarjetas desde `GET /api/tenants` (foto plato estrella, distrito, delivery, tiempo, comisión Culqi, código Yape, CTA a `/chat?tenant=<id>` y acceso a panel).

- **Página/ruta propuesta:** `frontend/src/routes/_authenticated/locales/index.tsx` → ruta `/locales`
  (`createFileRoute('/_authenticated/locales/')`), feature `frontend/src/features/locales/`.
  Item en sidebar General: `Locales → /locales` (icono `Store`/`LayoutGrid`, lucide).
  Nota: el prototipo era ruta pública `/`; en el template todo cuelga de `/_authenticated` (ver decisión D1: si la landing debe ser pública, crear además `frontend/src/routes/(public)/locales.tsx` sin `AuthenticatedLayout`).
- **Reusar del template:**
  - Shell `Header` + `Main` + `Search` (patrón `features/dashboard/index.tsx`).
  - `ui/card` (`CardHeader/Title/Description/Content`), `ui/badge` (distrito, comisión), `ui/button` (CTA "Abrir chat", "Ver panel"), `ui/skeleton` (3 skeletons de tarjeta), `ui/alert` + `role=alert` (error `GET /api/tenants` caído con comando de recovery).
  - Patrón de fetch de `features/carta`: `useQuery({ queryKey: ['tenants'], queryFn })` con `axios.get('/api/tenants')` + `refetch` + `toast`.
  - `penFormatter` (`Intl.NumberFormat('es-PE', { currency: 'PEN' })`) ya definido en carta para delivery/comisión.
- **Construir nuevo:**
  - `features/locales/components/tenant-card.tsx` (foto estrella con `onError` que oculta `img` y deja icono `UtensilsCrossed`, como hace carta), `features/locales/hooks/use-tenants.ts`.
  - Botón "Recargar demo" → `POST /api/demo/reset` + toast "demo recargada: 6 pedidos seed" (mismo copy del spec frontends).
  - Deep-link: cards enlazan a `/chat-cliente?tenant=<id>` y `/panel?tenant=<id>` con `Link` de TanStack Router + `validateSearch` zod (`tenant: z.string().optional()`).
  - Tokens Brasa (fondo `#FAF4E9`, tinta `#241A10`, tomate `#E4572E`, Fraunces/Chivo) vía CSS vars / clase scoped — no pelear con el theme shadcn global (ver riesgos).
- **Endpoints que consume:** `GET /api/tenants`, `POST /api/demo/reset`.
- **Estimación:** **S** (1 feature + 1 ruta, sin estado realtime).

## 2. Chat cliente (estilo WhatsApp + paybox)

Prototipo: `/chat` con selector de local + nombre cliente, burbujas in/out con hora, "escribiendo…", Markdown mínimo (`**negrita**`, `` `código` ``) con ESCAPE previo, foto en burbuja que se auto-elimina si falla, aviso de conexión como burbuja del bot, bloqueo de envíos simultáneos, paybox con QR Yape + botones Culqi/Yape.

- **Página/ruta propuesta:** `frontend/src/routes/_authenticated/chat-cliente/index.tsx` → ruta `/chat-cliente`
  (nombre distinto de `/chats` a propósito: `/chats` es el inbox genérico del template con data fake; no mezclar).
  Search schema zod: `{ tenant: z.string().optional().catch('faro'), cliente: z.string().optional().catch('') }` con `getRouteApi` + `useTableUrlState`-style o `Route.useSearch()` directo.
  Feature `frontend/src/features/chat-cliente/` (`components/message-bubble.tsx`, `typing-indicator.tsx`, `photo-bubble.tsx`, `pay-box.tsx`, `hooks/use-chat.ts`).
  Sidebar: `Chat cliente → /chat-cliente` (icono `MessageCircle`, distinto de `MessagesSquare` de Chats).
- **Reusar del template:**
  - Layout de `features/chats/index.tsx`: panel conversación derecha, `Avatar` + `ScrollArea` + `Separator`, input inferior con `Send`. Copiar el esqueleto, NO la data (`convo.json` fake se descarta).
  - `ui/avatar`, `ui/scroll-area`, `ui/button`, `ui/input`/`ui/textarea`, `ui/badge` (total, estado pago), `ui/skeleton` (burbujas skeleton), `ui/dialog` o `ui/sheet` para el paybox en mobile, `ui/alert` para errores inline, `sonner` para "pedido #n creado".
  - `date-fns/format` para la hora de cada burbuja (ya usado en chats).
- **Construir nuevo (todo):**
  - `use-chat`: `POST /api/chat` con estado `typing`, guard anti-doble-envío (disable mientras `isPending`), `aria-live="polite"` en la lista, error de conexión → burbuja del bot "se cortó la conexión, reintenta" (nunca `alert()`).
  - Render seguro: `escapeHtml(text)` ANTES de aplicar el mini-Markdown (`**…**`, `` `…` ``) e inyectar con `dangerouslySetInnerHTML` solo sobre el string escapado. Sin esto hay XSS (el spec lo exige: `<b>hola</b>` se ve literal).
  - `photo-bubble`: si la respuesta trae `foto`, burbuja-imagen ANTES del texto, `onError → remove` (patrón carta línea ~193).
  - `pay-box`: al confirmar crea pedido y link Culqi, muestra QR `https://yape.pe/pay/<codigo>?monto=<total>` con monto exacto destacado + fallback "QR no disponible (sin internet)"; botones: "Pagar con tarjeta · Culqi" (solo si `GET /api/payments/config` trae `culqi_pk`), "Culqi SIMULADO", "Yape exacto", "Yape falso −S/10" (demo anti-fraude); errores de cobro inline en el paybox + rehabilitar botón.
- **Endpoints que consume:** `POST /api/chat`, `POST /api/orders`, `POST /api/payments/culqi/link`, `POST /api/payments/culqi/webhook` (simulado), `POST /api/payments/culqi/charge` (real, solo con `CULQI_PUBLIC_KEY`), `POST /api/payments/yape`, `GET /api/payments/config?tenant=`, más lectura `GET /api/menu?tenant=` y `GET /api/tenants` para el selector.
- **Estimación:** **L** (la superficie más grande: chat stateful + render seguro + paybox con 4 caminos de pago).

## 3. Panel dueño (Kanban 5 columnas + drag&drop + anti-fraude 400)

Spec: `/panel` con columnas nuevo / confirmado / cocina / delivery / entregado, polling 4 s repintando solo columnas con firma cambiada (`id/pago/total/ítems`), ticket con cliente, ítems por nombre, total, pill de pago (ok/warn/bad), dirección y botón de avance; `PATCH` inválido → 400 `estado?`; avance a cocina/delivery/entregado con pago `pendiente`/`pendiente_verificar` → 400 anti Yape-falso con recovery "Cobra o verifica el pago primero"; filtro tenant (Todos + 3, también `?tenant=`); vacío que enseña ("Haz un pedido desde el chat").

- **Página/ruta propuesta:** `frontend/src/routes/_authenticated/panel/index.tsx` → ruta `/panel`,
  search zod `{ tenant: z.string().optional().catch('todos') }`, feature `frontend/src/features/panel/`
  (`components/kanban-board.tsx`, `kanban-column.tsx`, `order-ticket.tsx`, `hooks/use-orders.ts`).
  Sidebar: `Panel → /panel` (icono `KanbanSquare`/`Columns3`).
- **Reusar del template:**
  - Patrón `features/tasks`: `TasksProvider` (contexto) → `PanelProvider` (filtro tenant + selección), `DataTableToolbar`-style para el `Select` de tenant, `useTableUrlState` + `getRouteApi('/_authenticated/panel/')` para sincronizar `?tenant=` en URL, `Table`/`Card`/`Badge`/`Button`/`Skeleton`/`Alert`/`Dialog` (detalle ticket), `DropdownMenu` (acciones por ticket).
  - `Badge` variants para pill de pago: `pagado_*` → verde (`bg-emerald-600`, como carta), `pendiente_verificar` → ámbar/warn, `pendiente` → rojo/bad.
  - Polling con `useQuery({ queryKey: ['orders', tenant], queryFn, refetchInterval: 4000 })` + badge "en vivo · 4s" / "pausado".
- **Construir nuevo + veredicto drag&drop:**
  - **Verificado: el template NO trae nada arrastrable.** `features/tasks/components/tasks-table.tsx` es solo `@tanstack/react-table` (sorting, filtros por estado/prioridad, paginación, visibilidad de columnas, bulk actions, drawers de mutación). `package.json` no contiene `dnd-kit`, `@hello-pangea/dnd`, `react-beautiful-dnd` ni `sortablejs`. No hay `Sortable`, `Draggable`, `Droppable` ni `board/kanban` en `frontend/src` (búsqueda `dnd|drag|sortable|kanban|board` sin hits funcionales).
  - **Librería recomendada: `dnd-kit` (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`). Justificación:** (a) activamente mantenida y compatible con React 19 + StrictMode (el fork `@hello-pangea/dnd` arrastra la arquitectura legacy de `react-beautiful-dnd`, rompe con StrictMode/concurrent y solo modela listas verticales); (b) sensores pointer + keyboard + touch nativos → accesibilidad por teclado y `aria-live` exigidas por el spec de frontends, y táctil útil si el panel se usa en tablet; (c) `SortableContext` por columna + `useDroppable` por columna permite exactamente el modelo 5-columnas-con-tickets-reordenables + drop entre columnas = `PATCH estado`; (d) sin mutación del DOM fuera de React, convive con el repintado por diff (ver riesgo R2: congelar el polling durante el drag o reconciliar por firma).
  - `use-orders`: firma por columna `col.map(o => [o.id, o.pago, o.total, itemsKey].join('|')).join(';')`, solo repinta columnas cuya firma cambió (equivalente React del diff manual del prototipo; con TanStack Query el `data` nuevo solo re-renderiza lo que cambia si columnas están memoizadas con `React.memo`).
  - Drop o botón "avanzar" → `PATCH /api/orders/{id}`; 400 anti-fraude → error inline en el ticket + `sonner.error`, el ticket NO se mueve (rollback optimista).
- **Endpoints que consume:** `GET /api/orders?tenant=`, `PATCH /api/orders/{id}`, `POST /api/demo/reset` (botón recargar).
- **Estimación:** **L** (kanban 5 col + dnd-kit nuevo + polling con diff + rollback 400).

## 4. Cocina KDS (cola filtrada, tipografía grande, un tap avanza)

Spec: `/cocina` solo pedidos `confirmado`/`cocina` (los impagos ni aparecen), polling 4 s sin filtro de tenant, firma de lista `id|estado` (sin cambios → no tocar DOM), ticket con `cant× plato` en mono grande, cliente grande, local + dirección, badge "solo pagado verificado", botones "En cocina" / "Listo" (un tap → `PATCH`), error inline + rehabilitar, vacío "Cola libre — los pedidos pagados caen aquí solos", error de conexión inline con reintento 4 s.

- **Página/ruta propuesta:** `frontend/src/routes/_authenticated/cocina/index.tsx` → ruta `/cocina`,
  feature `frontend/src/features/cocina/` (`components/kds-ticket.tsx`, `hooks/use-kds.ts`).
  Sidebar: `Cocina → /cocina` (icono `ChefHat`/`Flame`).
- **Reusar del template:**
  - `ui/card`, `ui/badge`, `ui/button` (size `lg`, `h-12+` para targets táctiles), `ui/skeleton`, `ui/alert`, shell `Header` + `Main`.
  - Lógica de polling/firma de `features/panel` (KDS = vista filtrada del mismo `GET /api/orders`); reutilizar `order-ticket` del panel como base y agrandarlo.
  - `Chivo Mono`/`tabular-nums` para cantidades (`className="tabular-nums"`, como el precio en carta).
- **Construir nuevo:**
  - `use-kds`: `useQuery(['orders','kds'], refetchInterval: 4000)` + filtro cliente `estado === 'confirmado' || estado === 'cocina'` + firma `list.map(o => o.id + '|' + o.estado).join(',')`; columnas memoizadas para no parpadear.
  - `kds-ticket`: layout de alto contraste, cantidades `2× Ceviche` en `text-2xl+ font-mono font-bold`, cliente `text-xl`, dirección visible, botones de una sola acción con `disabled` durante el `PATCH` y error inline "No avanza: …".
  - Modo "rush": `prefers-reduced-motion` respetado, sin decoración que compita con el ticket (spec + DESIGN.md).
- **Endpoints que consume:** `GET /api/orders` (sin `?tenant=`, filtra en cliente), `PATCH /api/orders/{id}`.
- **Estimación:** **M** (reusa ~60% del panel; sin drag&drop; el trabajo es visual + filtro + firma).

## 5. Carta admin — ✅ HECHA

- **Página/ruta existente:** `frontend/src/routes/_authenticated/carta/index.tsx` → ruta `/carta`, feature `frontend/src/features/carta/index.tsx`. **No migrar: marcar como HECHA.**
  Ya implementa el patrón objetivo del resto de superficies: TanStack Query + axios, `Skeleton` en carga, `Alert` destructivo + "Reintentar", `Table` con foto (con `onError` hide) / plato / categoría / precio `tabular-nums` en PEN / `Badge` Disponible-Agotado, edición de precio con borrador por fila + error inline por fila + `toast.success('Precio actualizado')`.
- **Gaps menores (no bloquean el HECHA, backlog S):** `TENANT = 'faro'` hardcodeado → añadir `Select` de tenant (Todos no aplica; 3 tenants) con `queryKey: ['menu', tenant]`; falta toggle de `disponible` (el spec de carta/admin lo предполагает: la carta filtra `disponible: false`); `aria-live` en la tabla tras guardar.
- **Endpoints que consume:** `GET /api/menu?tenant=`, `POST /api/menu/toggle`.
- **Estimación:** **S** (solo gaps; la superficie como tal está terminada).

---

## Orden de migración recomendado (con estimación relativa)

| Orden | Superficie | Talla | Por qué en ese lugar |
|---|---|---|---|
| 1 | Carta gaps (selector tenant + toggle disponible) | **S** | Ya HECHA; calienta el patrón Query+axios+zod que copian las demás. |
| 2 | Locales `/locales` | **S** | Sin realtime; da el hub de navegación (`?tenant=`) que panel y chat reutilizan; valida tokens Brasa sobre shadcn. |
| 3 | Cocina `/cocina` | **M** | Reusa ticket+polling del panel sin el coste del drag&drop; entrega valor a cocina pronto y fija la firma/diff. |
| 4 | Panel `/panel` + dnd-kit | **L** | Depende del ticket y la firma de cocina; añade dnd-kit + rollback 400 + filtro URL. |
| 5 | Chat cliente `/chat-cliente` + paybox | **L** | La más compleja y la única que toca pagos (4 caminos); va última para apoyarse en panel/cocina ya vivos para verificar pedidos de extremo a extremo. |

Total relativo: **S + S + M + L + L**. Camino crítico: 2 → 4 → 5 (locales desbloquea deep-links, panel desbloquea verificación visual del chat).

## Riesgos

- **R1 — Polling 4 s + diff manual vs React Query.** El prototipo repintaba por firma para no parpadear/scroll-jump. Con `refetchInterval: 4000` + columnas `React.memo` por firma se logra lo mismo, pero hay que disciplinar `queryKey` por tenant e invalidar firmas al cambiar el filtro (spec pedidos-kanban lo exige). Si se usa `refetchIntervalInBackground` sin cuidado, tablets KDS consumen batería/datos.
- **R2 — Drag&drop vs repintado por polling.** Un `refetch` en mitad de un drag puede mover la tarjeta bajo el dedo. Mitigación: pausar el `refetch` mientras `activeDrag != null` (dnd-kit `DndContext onDragStart/End`) o cola de patches optimistas con rollback ante 400.
- **R3 — Estado en memoria del backend.** `app/store.py` con lock: todo se pierde al reinicio (decisión sandbox asumida). El frontend debe tratar `404 pedido?` / lista vacía tras reinicio como estado normal, no como bug, y ofrecer "Recargar demo".
- **R4 — Regla anti-fraude 400 como UX, no solo backend.** El `PATCH` rechazado debe dejar el ticket quieto + mensaje con recuperación ("Cobra o verifica el pago primero"). Un update optimista ingenuo violaría visiblemente la regla.
- **R5 — Paybox: QR sin internet + Culqi sin llaves.** `GET /api/payments/config` con `culqi_pk` vacío debe ocultar el botón real (spec pagos); el contenedor QR necesita el fallback "QR no disponible". No asumir `qrcodejs` disponible offline.
- **R6 — XSS en el chat.** El mini-Markdown sobre `innerHTML` exige escape-previo; cualquier atajo (mostrar `foto`/texto del bot sin escapar) abre inyección vía nombre de plato o mensaje.
- **R7 — Tema Brasa vs theme shadcn.** Fraunces/Chivo + crema `#FAF4E9`/tomate `#E4572E` chocan con las CSS vars del template (claro/oscuro + `ThemeSwitch`). Scopiar Brasa a las 5 features o aceptar deriva visual; no re-temear globalmente sin diseño.

## 3 decisiones que el equipo debe confirmar

- **D1 — ¿Rutas bajo `/_authenticated` o públicas?** El template cuelga todo de `AuthenticatedLayout` (login requerido), pero el prototipo servía `/`, `/chat`, `/panel`, `/cocina`, `/menu` sin login. Confirmar si Locales/Chat-cliente/Cocina van tras login (propuesta de este doc) o si se crea un grupo público `(public)/` sin auth para demo/tienda + KDS de tablet compartida.
- **D2 — ¿Drag&drop obligatorio en el panel o bastan los botones de avance?** dnd-kit es la recomendación si el drag es requisito (justificación en §3), pero añade dependencia + riesgo R2. Si el equipo acepta solo botones "Confirmar / A cocina / …" (que ya cumplen el spec mínimo), el panel baja de **L → M** y dnd-kit se pospone.
- **D3 — ¿Polling 4 s con TanStack Query o se salta a WebSocket/SSE?** El spec fija polling 4 s con diff; confirmarlo como techo (simple, sin backend nuevo) o aprobar `refetchInterval` adaptativo (pausa en background / tab oculta) y eventual push, porque KDS + panel con 4 s fijos escalan mal con muchos tenants abiertos.
