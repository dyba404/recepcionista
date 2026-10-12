/**
 * Formateo de fecha/hora con Intl en es-PE (nada de date-fns aquí: el inbox
 * y el wizard de WhatsApp usan estos helpers).
 */

const HORA_FMT = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
})

const FECHA_FMT = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
})

const FECHA_HORA_FMT = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const RELATIVO_FMT = new Intl.RelativeTimeFormat('es-PE', {
  numeric: 'auto',
})

function toDate(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "21:34" — hora corta para burbujas del hilo. */
export function formatHora(iso: string): string {
  const d = toDate(iso)
  return d ? HORA_FMT.format(d) : ''
}

/** "4 mar, 21:34" — para mensajes de días anteriores. */
export function formatFechaHora(iso: string): string {
  const d = toDate(iso)
  return d ? FECHA_HORA_FMT.format(d) : ''
}

/** "hace 5 min / hace 3 h / hace 2 días" — lista de conversaciones. */
export function formatHoraRelativa(iso: string): string {
  const d = toDate(iso)
  if (!d) return ''
  const minutos = Math.round((d.getTime() - Date.now()) / 60_000)
  if (Math.abs(minutos) < 1) return 'ahora'
  if (Math.abs(minutos) < 60) return RELATIVO_FMT.format(minutos, 'minute')
  const horas = Math.round(minutos / 60)
  if (Math.abs(horas) < 24) return RELATIVO_FMT.format(horas, 'hour')
  const dias = Math.round(horas / 24)
  if (Math.abs(dias) < 7) return RELATIVO_FMT.format(dias, 'day')
  return FECHA_FMT.format(d)
}

/** Clave local del día ("2026-10-11") para separadores del hilo. */
function claveDia(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const HOY = new Date()
const CLAVE_HOY = claveDia(HOY)
const CLAVE_AYER = claveDia(new Date(HOY.getTime() - 86_400_000))

/** "Hoy" | "Ayer" | "4 mar" — separador de día en el hilo de mensajes. */
export function etiquetaDia(iso: string): string {
  const d = toDate(iso)
  if (!d) return ''
  const clave = claveDia(d)
  if (clave === CLAVE_HOY) return 'Hoy'
  if (clave === CLAVE_AYER) return 'Ayer'
  return FECHA_FMT.format(d)
}
