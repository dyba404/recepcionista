import { createFileRoute, redirect } from '@tanstack/react-router'

/** El wizard vive ahora en Configuración → Canal de WhatsApp (su lugar
 * natural: es una configuración, no un destino de navegación). */
export const Route = createFileRoute('/_authenticated/mensajeria/conectar/')({
  beforeLoad: () => {
    throw redirect({ to: '/configuracion/whatsapp' })
  },
})
