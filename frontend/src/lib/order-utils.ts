import {
  ORDER_ESTADOS,
  type OrderEstado,
  type OrderPago,
} from '@/lib/types'

export const TENANT_IDS = ['faro', 'brasa', 'juana'] as const

/** Plato estrella por tenant para la foto en /locales (f1/b1/j1.jpg). */
const ESTRELLA: Record<string, string> = {
  faro: 'f1',
  brasa: 'b1',
  juana: 'j1',
}

export function tenantFoto(tenantId: string): string {
  return `/static/img/platos/${ESTRELLA[tenantId] ?? `${tenantId.charAt(0)}1`}.jpg`
}

/** Etiqueta del botón de avance según el estado actual ('' en entregado). */
export function avanceLabel(estado: OrderEstado): string {
  if (estado === 'entregado') return ''
  return AVANCE_LABEL[estado]
}

export const AVANCE_LABEL: Record<
  Exclude<OrderEstado, 'entregado'>,
  string
> = {
  nuevo: 'Confirmar',
  confirmado: 'A cocina',
  cocina: 'A delivery',
  delivery: 'Entregar',
}

export const ESTADO_LABEL: Record<OrderEstado, string> = {
  nuevo: 'Nuevo',
  confirmado: 'Confirmado',
  cocina: 'Cocina',
  delivery: 'Delivery',
  entregado: 'Entregado',
}

/** true si `target` es un avance válido (mismo o posterior estado). */
export function esAvanceValido(
  from: OrderEstado,
  target: OrderEstado
): boolean {
  return (
    ORDER_ESTADOS.indexOf(target) >= ORDER_ESTADOS.indexOf(from)
  )
}

/** Siguiente estado del pipeline (null si ya está en entregado). */
export function siguienteEstado(estado: OrderEstado): OrderEstado | null {
  const i = ORDER_ESTADOS.indexOf(estado)
  return i >= 0 && i < ORDER_ESTADOS.length - 1
    ? ORDER_ESTADOS[i + 1]
    : null
}

export const penFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
})

export const PAGO_LABEL: Record<OrderPago, string> = {
  pendiente: 'Pendiente',
  pendiente_verificar: 'Por verificar',
  pagado_culqi: 'Pagado · Culqi',
  pagado_yape: 'Pagado · Yape',
  pagado_culqi_real: 'Pagado · Culqi real',
}
