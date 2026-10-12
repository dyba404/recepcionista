import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { Loader2, UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api, apiErrorDetail } from '@/lib/api'
import type { AuthUser, LoginResponse } from '@/lib/types'
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

/**
 * Registro real (contrato saas-cola-2): una sola pantalla crea la cuenta Y
 * el local — POST /api/auth/register con `negocio: {nombre, distrito,
 * delivery}` crea el tenant y deja al usuario como su owner. Con token en
 * la respuesta se entra directo; si el backend aún devolviera solo el
 * usuario, se hace login explícito con las mismas credenciales.
 */
const formSchema = z.object({
  nombre: z.string().min(1, 'Escribe tu nombre.'),
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Escribe tu correo.' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Escribe una contraseña.')
    .min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  negocioNombre: z.string().min(1, 'Escribe el nombre de tu local.'),
  distrito: z.string().min(1, 'Escribe el distrito de tu local.'),
  delivery: z
    .string()
    .optional()
    .refine(
      (v) =>
        !v ||
        v.trim() === '' ||
        (!Number.isNaN(Number(v)) && Number(v) >= 0),
      'Escribe un costo de delivery válido, ej. 5'
    ),
})

interface RegisterFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function RegisterForm({
  className,
  redirectTo,
  ...props
}: RegisterFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setAccessToken, setUser } = useAuthStore((s) => s.auth)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre: '',
      email: '',
      password: '',
      negocioNombre: '',
      distrito: '',
      delivery: '5', // opcional con default 5 (contrato saas-cola-2)
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setRegisterError(null)

    const delivery =
      data.delivery && data.delivery.trim() !== '' ? Number(data.delivery) : 5

    try {
      const res = await api.post<LoginResponse | AuthUser>(
        '/api/auth/register',
        {
          nombre: data.nombre.trim(),
          email: data.email.trim(),
          password: data.password,
          negocio: {
            nombre: data.negocioNombre.trim(),
            distrito: data.distrito.trim(),
            delivery,
          },
        },
        { skipAuthRedirect: true } // el 401/409 aquí es error inline
      )

      if ('access_token' in res.data && res.data.access_token) {
        // Contrato saas-cola-2: register devuelve token + user como login.
        setAccessToken(res.data.access_token)
        setUser(res.data.user)
      } else {
        // Backend que aún devuelve solo el usuario → login explícito.
        const login = await api.post<LoginResponse>(
          '/api/auth/login',
          { email: data.email.trim(), password: data.password },
          { skipAuthRedirect: true }
        )
        setAccessToken(login.data.access_token)
        setUser(login.data.user)
      }

      const user = useAuthStore.getState().auth.user
      toast.success(`Bienvenido, ${user?.nombre || data.email.trim()}`, {
        description: 'Tu cuenta y tu local quedaron creados.',
      })
      navigate({ to: redirectTo || '/', replace: true })
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 409) {
        setRegisterError(
          apiErrorDetail(err) ?? 'Ese email ya está registrado.'
        )
      } else {
        setRegisterError(
          apiErrorDetail(err) ??
            'No se pudo crear tu cuenta. Revisa que el backend esté arriba e inténtalo de nuevo.'
        )
      }
    } finally {
      setIsLoading(false)
    }
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
          name='nombre'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tu nombre</FormLabel>
              <FormControl>
                <Input
                  placeholder='Ej. Rosa Quispe'
                  autoComplete='name'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo</FormLabel>
              <FormControl>
                <Input
                  placeholder='tu@correo.pe'
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
                  placeholder='Mínimo 8 caracteres'
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ===== Sección "Tu negocio" ===== */}
        <div className='relative my-2'>
          <div className='absolute inset-0 flex items-center'>
            <span className='w-full border-t' />
          </div>
          <div className='relative flex justify-center text-xs uppercase'>
            <span className='bg-background px-2 text-muted-foreground'>
              Tu negocio
            </span>
          </div>
        </div>
        <p className='-mt-2 text-xs text-muted-foreground'>
          Con estos datos te creamos el local: quedarás como su dueño y su
          carta, panel y pagos empiezan vacíos.
        </p>

        <FormField
          control={form.control}
          name='negocioNombre'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre del local</FormLabel>
              <FormControl>
                <Input placeholder='Ej. Pollería El Brasero' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='grid gap-3 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='distrito'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Distrito</FormLabel>
                <FormControl>
                  <Input placeholder='Ej. Surco' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='delivery'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Delivery (S/){' '}
                  <span className='font-normal text-muted-foreground'>
                    · opcional
                  </span>
                </FormLabel>
                <FormControl>
                  <Input
                    inputMode='decimal'
                    placeholder='5'
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {registerError && (
          <p role='alert' className='text-sm font-medium text-destructive'>
            {registerError}
          </p>
        )}

        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? (
            <Loader2 className='animate-spin' />
          ) : (
            <UserRoundPlus />
          )}
          Crear cuenta y local
        </Button>
      </form>
    </Form>
  )
}
