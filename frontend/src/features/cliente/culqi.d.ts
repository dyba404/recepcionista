/**
 * Globales que define culqi.js v4 (CDN https://checkout.culqi.com/js/v4),
 * cargado dinámicamente desde ./culqi-checkout — no hay paquete npm, así
 * que aquí van los tipos que el DOM lib no conoce (window.Culqi /
 * window.culqi_token).
 */
import type { CulqiCheckout, CulqiToken } from './culqi-checkout'

declare global {
  interface Window {
    /** Constructor global del checkout: new Culqi({publicKey}). */
    Culqi?: new (options: { publicKey: string }) => CulqiCheckout
    /** Token de la tarjeta cuando el cliente aprueba el pago. */
    culqi_token?: CulqiToken | null
  }
}
