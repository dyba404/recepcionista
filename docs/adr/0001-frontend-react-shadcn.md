# ADR 0001 — Frontend del SaaS: React/Vite + shadcn/ui (base shadcn-admin)

Fecha: 2026-10-11 · Estado: aceptada · Decide: dueño (opción B elegida sobre la
recomendación A/Tabler)

## Contexto
El prototipo (FastAPI + 5 HTML estáticos) se convierte en SaaS. El criterio fue
adaptar repos existentes en lugar de improvisar una UI propia. Se evaluaron dos
caminos (2026-10-11): Tabler+SortableJS (sin build) vs React/Vite+shadcn/ui.

## Decisión
Frontend **React + Vite + TypeScript + Tailwind + shadcn/ui**, adaptando
**satnaing/shadcn-admin** (MIT, 15.6k★, Vite + TanStack Router; shell de admin,
settings, página de chats). Se eliminan mocks y auth de Clerk; el estado de servidor
va con **TanStack Query** contra la API FastAPI (proxy /api en dev, backend sirve
`frontend/dist` en producción). Kanban/KDS: **@dnd-kit** sobre componentes shadcn
(los candidatos kanban listos no cubren KDS; ver investigación). Chat del cliente:
componente React propio sobre primitivas shadcn, tomando el patrón de burbujas de
la página chats de shadcn-admin y los endpoints del backend (/api/chat, fotos,
paybox, QR).

## Consecuencias
+ Ecosistema SaaS moderno (auth/billing multi-tenant a futuro), tipado, componentes
  accesibles listos; calidad de UI superior a Tabler para producto comercial.
− Requiere toolchain Node en Windows (npm install por proyecto, ~1 vez).
− Kanban/KDS/chat se arman con primitivas existentes (no hay template KDS en GitHub;
  hallazgo de la investigación) — el riesgo de improvisación se mitiga con specs
  Specs de frontend y revisión visual.
- Se documenta qué se toma de cada repo en cada ADR subsiguiente.
