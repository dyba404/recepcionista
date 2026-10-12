import { createFileRoute } from '@tanstack/react-router'
import { PasarelaPagos } from '@/features/pagos'

export const Route = createFileRoute('/_authenticated/configuracion/pagos/')({
  component: PasarelaPagos,
})
