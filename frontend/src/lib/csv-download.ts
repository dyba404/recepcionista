import { api, apiErrorDetail } from '@/lib/api'

/**
 * Descarga de reportes CSV (contrato endurecer-local, sección A): axios con
 * responseType 'blob' → URL.createObjectURL → <a download>. El backend firma
 * el attachment con el tenant (BOM UTF-8 + CRLF para Excel); si manda
 * Content-Disposition se respeta su filename, si no se usa el fallback.
 *
 * El botón que la invoca se deshabilita mientras descarga y toastea el
 * error si falla — ver `csvErrorDetail` para extraer el `detail` aunque el
 * body del error también llegue como Blob.
 */
export async function descargarCsv(
  url: string,
  params: Record<string, string | undefined>,
  nombreFallback: string
): Promise<void> {
  const res = await api.get<Blob>(url, { params, responseType: 'blob' })

  let nombre = nombreFallback
  const disposition = res.headers['content-disposition']
  if (typeof disposition === 'string') {
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition)
    if (match?.[1]) nombre = decodeURIComponent(match[1].trim())
  }

  const href = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = href
  link.download = nombre
  document.body.appendChild(link)
  link.click()
  link.remove()
  // el object URL se libera un rato después: el click es síncrono
  window.setTimeout(() => URL.revokeObjectURL(href), 5_000)
}

/**
 * `detail` de un error de descarga: con responseType 'blob' el body del
 * error (403 de rol, 422 de validación…) también llega como Blob, así que
 * se lee el texto y se parsea a mano antes de caer al apiErrorDetail
 * estándar. Devuelve undefined si no hay detail legible.
 */
export async function csvErrorDetail(
  error: unknown
): Promise<string | undefined> {
  const data = (
    error as { response?: { data?: unknown } } | undefined
  )?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { detail?: unknown }
      if (typeof parsed.detail === 'string' && parsed.detail.length > 0) {
        return parsed.detail
      }
    } catch {
      // body de error no-JSON (p.ej. HTML de un proxy) → detail estándar
    }
  }
  return apiErrorDetail(error)
}
