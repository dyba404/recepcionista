import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '@/features/auth/sign-in'
import { useAuthStore } from '@/stores/auth-store'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignIn,
  validateSearch: searchSchema,
  // Con sesión activa (token + user ya hidratados) el login no aplica:
  // directo al dashboard. Si solo hay token (user por verificar) se queda,
  // para no crear un bucle cuando el backend aún no responde.
  beforeLoad: () => {
    const { accessToken, user } = useAuthStore.getState().auth
    if (accessToken && user) {
      throw redirect({ to: '/', replace: true })
    }
  },
})
