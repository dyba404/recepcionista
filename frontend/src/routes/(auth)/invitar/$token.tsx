import { createFileRoute } from '@tanstack/react-router'
import { Invitar } from '@/features/auth/invitar'

/**
 * Ruta pública de aceptar invitación (contrato endurecer-local): el token
 * viaja en el path y la página es tan pública como /sign-in — sin guardia
 * de sesión (un dueño logueado puede abrir el enlace de un invitado sin
 * que lo botemos).
 */
export const Route = createFileRoute('/(auth)/invitar/$token')({
  component: Invitar,
})
