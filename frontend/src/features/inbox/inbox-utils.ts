import type { Conversation } from '@/lib/types'

/** Etiquetas y colores del estado de handoff (bot / humano / resuelta). */
export const CONV_ESTADO_LABEL: Record<string, string> = {
  bot: 'Bot',
  humano: 'Humano',
  resuelta: 'Resuelta',
}

export const CONV_ESTADO_STYLE: Record<string, string> = {
  bot: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  humano: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  resuelta: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
}

/** Iniciales para el avatar (Chatwoot style). */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0]! + partes[1][0]!).toUpperCase()
}

/** Ordena por último mensaje, lo más reciente primero. */
export function porReciente(a: Conversation, b: Conversation): number {
  const ta = Date.parse(a.last_message_at)
  const tb = Date.parse(b.last_message_at)
  const na = Number.isNaN(ta) ? 0 : ta
  const nb = Number.isNaN(tb) ? 0 : tb
  return nb - na
}

/** Ordena mensajes del más antiguo al más reciente (hilo). */
export function porAntiguo(a: { created_at: string }, b: { created_at: string }): number {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  const na = Number.isNaN(ta) ? 0 : ta
  const nb = Number.isNaN(tb) ? 0 : tb
  return na - nb
}
