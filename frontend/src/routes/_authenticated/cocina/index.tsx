import { createFileRoute } from '@tanstack/react-router'
import { Cocina } from '@/features/cocina'

export const Route = createFileRoute('/_authenticated/cocina/')({
  component: Cocina,
})
