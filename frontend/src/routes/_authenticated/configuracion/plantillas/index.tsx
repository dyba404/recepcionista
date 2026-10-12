import { createFileRoute } from '@tanstack/react-router'
import { Plantillas } from '@/features/plantillas'

export const Route = createFileRoute(
  '/_authenticated/configuracion/plantillas/'
)({
  component: Plantillas,
})
