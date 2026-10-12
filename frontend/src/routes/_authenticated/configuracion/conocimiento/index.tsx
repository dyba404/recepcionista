import { createFileRoute } from '@tanstack/react-router'
import { Conocimiento } from '@/features/conocimiento'

export const Route = createFileRoute(
  '/_authenticated/configuracion/conocimiento/'
)({
  component: Conocimiento,
})
