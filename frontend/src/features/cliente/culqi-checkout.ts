/**
 * Checkout REAL de Culqi (culqi.js v4): el script se carga UNA sola vez
 * desde el CDN (no hay dependencia npm), se abre el checkout con la llave
 * pública del local y se espera el token con polling defensivo — el
 * mismo patrón del legacy static/chat.html payCulqiReal.
 */

/** Token de tarjeta que culqi.js deja en window.culqi_token al aprobar. */
export interface CulqiToken {
  id: string
}

/** Instancia del checkout v4: settings() configura el cobro, open() lo muestra. */
export interface CulqiCheckout {
  settings(settings: { title: string; currency: string; amount: number }): void
  open(): void
}

const CULQI_JS_URL = 'https://checkout.culqi.com/js/v4/index.js'

/** Sentinel: el usuario cerró el checkout sin completar el pago. */
export const CHECKOUT_CERRADO = 'checkout-cerrado'

/** Promesa de carga del script (una sola vez; reintentable si falla). */
let cargaPendiente: Promise<void> | null = null

function cargarCulqiJs(): Promise<void> {
  if (window.Culqi) return Promise.resolve()
  if (cargaPendiente) return cargaPendiente

  cargaPendiente = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CULQI_JS_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Permite reintentar la carga en el siguiente click.
      cargaPendiente = null
      reject(new Error('culqi.js no cargó (revisa tu conexión)'))
    }
    document.head.appendChild(script)
    // Tope defensivo del legacy: si en 10 s no está el global, se rinde.
    window.setTimeout(() => {
      if (!window.Culqi) {
        cargaPendiente = null
        reject(new Error('culqi.js tardó demasiado'))
      }
    }, 10_000)
  })
  return cargaPendiente
}

/** Instancia viva del checkout (se crea con la publicKey del local). */
let checkout: CulqiCheckout | null = null

/**
 * Abre el checkout de Culqi y espera el token de la tarjeta: poll de
 * window.culqi_token cada 300 ms hasta 90 s (300 × 300 ms). Si el
 * cliente cierra sin pagar, se rechaza con CHECKOUT_CERRADO.
 */
export async function abrirCheckoutCulqi(opts: {
  publicKey: string
  /** Nombre del local que verá el cliente en el checkout. */
  title: string
  /** Total del pedido en soles (culqi.js lo quiere en céntimos). */
  total: number
}): Promise<CulqiToken> {
  await cargarCulqiJs()
  const Culqi = window.Culqi
  if (!Culqi) {
    throw new Error('culqi.js no está disponible')
  }
  if (!checkout) {
    checkout = new Culqi({ publicKey: opts.publicKey })
  }
  checkout.settings({
    title: opts.title,
    currency: 'PEN',
    amount: Math.round(opts.total * 100),
  })
  window.culqi_token = null
  checkout.open()

  return await new Promise<CulqiToken>((resolve, reject) => {
    let ticks = 0
    const timer = window.setInterval(() => {
      ticks++
      const token = window.culqi_token
      if (token?.id) {
        window.clearInterval(timer)
        window.culqi_token = null
        resolve(token)
      } else if (ticks >= 300) {
        window.clearInterval(timer)
        reject(new Error(CHECKOUT_CERRADO))
      }
    }, 300)
  })
}
