import { createFileRoute } from '@tanstack/react-router'
import { Carta } from '@/features/carta'

export const Route = createFileRoute('/_authenticated/carta/')({
  component: Carta,
})
