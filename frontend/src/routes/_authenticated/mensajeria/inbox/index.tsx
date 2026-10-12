import { createFileRoute } from '@tanstack/react-router'
import { Inbox } from '@/features/inbox'

export const Route = createFileRoute('/_authenticated/mensajeria/inbox/')({
  component: Inbox,
})
