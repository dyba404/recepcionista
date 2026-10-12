import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { SignUp } from '@/features/auth/sign-up'
import { useAuthStore } from '@/stores/auth-store'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
  validateSearch: searchSchema,
  // Con sesión activa (token + user ya hidratados) el registro no aplica:
  // directo al dashboard. Igual que /sign-in.
  beforeLoad: () => {
    const { accessToken, user } = useAuthStore.getState().auth
    if (accessToken && user) {
      throw redirect({ to: '/', replace: true })
    }
  },
})
