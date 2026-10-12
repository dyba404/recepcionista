import { createFileRoute } from '@tanstack/react-router'
import { ConectarWhatsapp } from '@/features/whatsapp'

export const Route = createFileRoute('/_authenticated/configuracion/whatsapp/')({
  component: ConectarWhatsapp,
})
