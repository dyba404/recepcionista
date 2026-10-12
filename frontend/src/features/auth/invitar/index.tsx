import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { LoginResponse } from '@/lib/types'
import { useAuthStore } from '@/stores/auth-store'
import { useInvitacionPublica } from '@/hooks/use-invitaciones'
import { BrandLogo } from '@/components/brand-logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { AuthLayout } from '../auth-layout'

/**
 * Ruta pública /invitar/{token} (contrato endurecer-local, sección C): el
 * invitado abre el enlace que compartió el dueño/admin, ve el local, su
 * correo y el rol con el que entra, y crea su cuenta con nombre + contraseña
 * (POST /api/invitaciones/{token}/aceptar → access_token + user — login
 * directo como register). Si la invitación no es válida (expiró, fue
 * revocada, ya se aceptó o el token no existe) muestra el estado honesto y
 * un link a /sign-in; un error de red es distinto: se ofrece reintentar.
 */

const routeApi = getRouteApi('/(auth)/invitar/$token')

const formSchema = z.object({
  nombre: z.string().min(1, 'Escribe tu nombre.'),
  password: z
    .string()
    .min(1, 'Escribe una contraseña.')
    .min(8, 'La contraseña debe tener al menos 8 caracteres.'),
})

/** Badge del rol invitado (colores de la matriz roles-equipo). */
function RolInvitado({ rol }: { rol: string }) {
  if (rol === 'owner') {
    return <Badge className='bg-emerald-600 text-white'>Dueño</Badge>
  }
  if (rol === 'admin') {
    return <Badge className='bg-blue-600 text-white'>Administrador</Badge>
  }
  return (
    <Badge
      variant='outline'
      className='border-amber-500/40 text-amber-700 dark:text-amber-400'
    >
      Staff
    </Badge>
  )
}

export function Invitar() {
  const { token } = routeApi.useParams()
  const {
    data: invitacion,
    isPending,
    isError,
    error,
    refetch,
  } = useInvitacionPublica(token)

  const [isLoading, setIsLoading] = useState(false)
  const [aceptarError, setAceptarError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { setAccessToken, setUser } = useAuthStore((s) => s.auth)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { nombre: '', password: '' },
  })

  const valida = !isPending && !isError && (invitacion?.valida ?? false)

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setAceptarError(null)
    try {
      const res = await api.post<LoginResponse>(
        `/api/invitaciones/${token}/aceptar`,
        {
          nombre: values.nombre.trim(),
          password: values.password,
        },
        { skipAuthRedirect: true } // un 401/409 aquí es error del form
      )
      setAccessToken(res.data.access_token)
      setUser(res.data.user)
      const user = useAuthStore.getState().auth.user
      toast.success(`Bienvenido, ${user?.nombre ?? values.nombre.trim()}`, {
        description: 'Ya eres parte del equipo del local.',
      })
      navigate({ to: '/', replace: true })
    } catch (err) {
      setAceptarError(
        apiErrorDetail(err) ??
          'No se pudo aceptar la invitación. Revisa que el enlace siga vigente e inténtalo de nuevo.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader className='items-start'>
          <div className='mb-1 flex items-center gap-2.5'>
            <BrandLogo className='size-9 rounded-lg' />
            <div className='grid leading-tight'>
              <span className='font-display text-lg font-bold tracking-tight'>
                Recepcionista
              </span>
              <span className='text-xs text-muted-foreground'>
                SaaS de pedidos por WhatsApp
              </span>
            </div>
          </div>
          {isPending ? (
            <div className='w-full space-y-2'>
              <Skeleton className='h-6 w-44' />
              <Skeleton className='h-4 w-60' />
            </div>
          ) : valida ? (
            <>
              <CardTitle className='text-lg tracking-tight'>
                Te invitaron a {invitacion?.local ?? 'un local'}
              </CardTitle>
              <CardDescription>
                Crea tu contraseña y entra al equipo con tu correo{' '}
                <span className='font-medium text-foreground'>
                  {invitacion?.email}
                </span>
                .
              </CardDescription>
            </>
          ) : (
            <CardTitle className='text-lg tracking-tight'>Invitación</CardTitle>
          )}
        </CardHeader>
        <CardContent className='grid gap-4'>
          {isPending && (
            <div className='space-y-3'>
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-9 w-full' />
            </div>
          )}

          {isError && (
            <Alert variant='destructive'>
              <AlertTriangle className='size-4' />
              <AlertTitle>No se pudo verificar la invitación</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>{error.message}</span>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  onClick={() => void refetch()}
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!isPending && !isError && !valida && (
            <>
              <Alert>
                <ShieldAlert className='size-4' />
                <AlertTitle>
                  La invitación expiró o fue revocada
                </AlertTitle>
                <AlertDescription>
                  {invitacion?.motivo ??
                    'Pídele al dueño del local que te genere una invitación nueva.'}
                </AlertDescription>
              </Alert>
              <p className='text-center text-sm text-muted-foreground'>
                ¿Ya tienes cuenta?{' '}
                <Link
                  to='/sign-in'
                  className='font-medium text-primary underline-offset-4 hover:underline'
                >
                  Inicia sesión
                </Link>
              </p>
            </>
          )}

          {valida && (
            <>
              <div className='flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground'>Correo</span>
                  <span className='truncate font-medium'>
                    {invitacion?.email}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground'>Rol</span>
                  <RolInvitado rol={invitacion?.rol ?? 'staff'} />
                </div>
              </div>

              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='grid gap-3'
                >
                  <FormField
                    control={form.control}
                    name='nombre'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tu nombre</FormLabel>
                        <FormControl>
                          <Input
                            placeholder='Ej. Marco Cocina'
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
                    name='password'
                    render={({ field }) => (
                      <FormItem>
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

                  {aceptarError && (
                    <p
                      role='alert'
                      className='text-sm font-medium text-destructive'
                    >
                      {aceptarError}
                    </p>
                  )}

                  <Button className='gap-1.5' disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className='animate-spin' />
                    ) : (
                      <UserRoundCheck />
                    )}
                    Crear mi cuenta
                  </Button>
                </form>
              </Form>
            </>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
