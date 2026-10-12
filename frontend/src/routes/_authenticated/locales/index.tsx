import { createFileRoute } from '@tanstack/react-router'
import { Locales } from '@/features/locales'

export const Route = createFileRoute('/_authenticated/locales/')({
  component: Locales,
})
