import { createFileRoute } from '@tanstack/react-router'
import { Dashboard } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  // Resumen real: KPIs y últimos pedidos desde GET /api/orders (con Bearer).
  component: Dashboard,
})
