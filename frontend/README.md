# Recepcionista — Frontend

Panel web del SaaS Recepcionista: Kanban de pedidos del dueño (Nuevo/Confirmado/Cocina/Delivery),
KDS de cocina, administración de la carta y sesión del local. React 19 + Vite + TanStack
Router/Query + shadcn/ui sobre una base shadcn-admin.

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:5173 con proxy /api -> :8000
```

La API vive en `../backend` (FastAPI). Ver el README de la raíz para el flujo completo y los pagos.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite). |
| `npm run build` | Build de producción (`tsc -b && vite build`). |
| `npm run lint` | ESLint. |
| `npm test` | Vitest en modo navegador headless. |
| `npm run test:coverage` | Cobertura de tests. |
| `npm run test:browser:install` | Instala Chromium para los tests de navegador. |
