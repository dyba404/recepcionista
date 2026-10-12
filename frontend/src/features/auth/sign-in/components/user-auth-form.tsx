import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api, apiErrorDetail } from '@/lib/api'
import type { LoginResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Escribe tu correo.' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Escribe tu contraseña.')
    .min(8, 'La contraseña debe tener al menos 8 caracteres.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

/** Cuentas sembradas por el backend demo (ADR 0002). */
const DEMO_ACCOUNTS = [
  {
    email: 'admin@demo.pe',
    password: 'demo1234',
    nombre: 'Admin demo',
    rol: 'owner',
    desc: 'Dueño: panel, carta y reset de demo',
  },
  {
    email: 'cocina@demo.pe',
    password: 'demo1234',
    nombre: 'Cocina demo',
    rol: 'staff',
    desc: 'Staff: pantalla de cocina (KDS)',
  },
] as const

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setAccessToken, setUser } = useAuthStore((s) => s.auth)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setLoginError(null)

    try {
      const res = await api.post<LoginResponse>(
        '/api/auth/login',
        { email: data.email, password: data.password },
        { skipAuthRedirect: true } // el 401 aquí es error inline, no logout
      )
      setAccessToken(res.data.access_token)
      setUser(res.data.user)
      toast.success(`Bienvenido, ${res.data.user.nombre || data.email}`)
      navigate({ to: redirectTo || '/', replace: true })
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        setLoginError('Credenciales incorrectas')
      } else {
        setLoginError(
          apiErrorDetail(err) ??
            'No se pudo conectar con el servidor. Revisa que el backend esté arriba.'
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  function aplicarCuentaDemo(account: (typeof DEMO_ACCOUNTS)[number]) {
    form.setValue('email', account.email)
    form.setValue('password', account.password)
    void form.handleSubmit(onSubmit)()
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input
                  placeholder='admin@demo.pe'
                  type='email'
                  autoComplete='email'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem className='relative'>
              <FormLabel>Contraseña</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {loginError && (
          <p role='alert' className='text-sm font-medium text-destructive'>
            {loginError}
          </p>
        )}

        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Entrar
        </Button>

        <div className='relative my-2'>
          <div className='absolute inset-0 flex items-center'>
            <span className='w-full border-t' />
          </div>
          <div className='relative flex justify-center text-xs uppercase'>
            <span className='bg-background px-2 text-muted-foreground'>
              Cuentas demo
            </span>
          </div>
        </div>

        <div className='grid gap-2'>
          {DEMO_ACCOUNTS.map((account) => (
            <div
              key={account.email}
              className='flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2'
            >
              <div className='min-w-0'>
                <p className='flex items-center gap-1.5 text-sm font-medium'>
                  {account.rol === 'owner' ? (
                    <ShieldCheck className='size-3.5 text-emerald-600' />
                  ) : (
                    <KeyRound className='size-3.5 text-amber-600' />
                  )}
                  {account.nombre}
                  <span className='font-normal text-muted-foreground'>
                    · {account.rol}
                  </span>
                </p>
                <p className='truncate text-xs text-muted-foreground'>
                  {account.desc}
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={isLoading}
                onClick={() => aplicarCuentaDemo(account)}
              >
                Usar
              </Button>
            </div>
          ))}
        </div>
      </form>
    </Form>
  )
}
