/** Helpers del simulador de chat de cliente (demo). */

/** Nombre del bot por local: faro → FaroBot, brasa → BrasaBot, juana → JuanaBot. */
export function botName(tenantId: string): string {
  const base = tenantId.charAt(0).toUpperCase() + tenantId.slice(1)
  return `${base}Bot`
}

/**
 * Plato demo con el que se crea un pedido de prueba si el bot responde
 * next='pago' con el carrito vacío (mismo fallback que el legacy
 * static/chat.html: f1 / b2 / j1).
 */
export function platoDemo(tenantId: string): string {
  if (tenantId === 'brasa') return 'b2'
  if (tenantId === 'juana') return 'j1'
  return 'f1'
}

/** Sugerencias del empty hint — prueban carta, pedido y foto. */
export const EJEMPLOS = ['menu', 'quiero 2 ceviche', 'tienes foto del lomo?'] as const
