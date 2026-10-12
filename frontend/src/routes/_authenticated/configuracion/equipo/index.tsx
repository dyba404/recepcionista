import { createFileRoute } from '@tanstack/react-router'
import { Equipo } from '@/features/equipo'

export const Route = createFileRoute(
  '/_authenticated/configuracion/equipo/'
)({
  component: Equipo,
})
