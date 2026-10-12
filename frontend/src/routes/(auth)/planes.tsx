import { createFileRoute } from '@tanstack/react-router'
import { Planes } from '@/features/planes'

/**
 * /planes — pricing pública del SaaS (contrato endurecer-local): sin
 * guardia de sesión. Con sesión marca el plan actual y el CTA activa con
 * PATCH; sin sesión manda a /sign-up, así que nunca redirige a quien ya
 * entró.
 */
export const Route = createFileRoute('/(auth)/planes')({
  component: Planes,
})
