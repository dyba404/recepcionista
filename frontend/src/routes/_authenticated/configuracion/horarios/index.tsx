import { createFileRoute } from '@tanstack/react-router'
import { Horarios } from '@/features/horarios'

export const Route = createFileRoute(
  '/_authenticated/configuracion/horarios/'
)({
  component: Horarios,
})
