import { createFileRoute } from '@tanstack/react-router'
import { Modulos } from '@/features/modulos'

export const Route = createFileRoute('/_authenticated/configuracion/modulos/')(
  {
    component: Modulos,
  }
)
