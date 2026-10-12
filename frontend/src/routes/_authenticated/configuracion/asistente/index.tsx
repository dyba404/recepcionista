import { createFileRoute } from '@tanstack/react-router'
import { Asistente } from '@/features/asistente'

export const Route = createFileRoute(
  '/_authenticated/configuracion/asistente/'
)({
  component: Asistente,
})
