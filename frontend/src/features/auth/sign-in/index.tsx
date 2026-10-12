import { Link, useSearch } from '@tanstack/react-router'
import { BrandLogo } from '@/components/brand-logo'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

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
          <CardTitle className='text-lg tracking-tight'>
            Inicia sesión
          </CardTitle>
          <CardDescription>
            Pedidos por WhatsApp, cobro verificado y cocina en vivo — demo
            sandbox.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          <UserAuthForm redirectTo={redirect} />
          <p className='text-center text-sm text-muted-foreground'>
            ¿Primera vez aquí?{' '}
            <Link
              to='/sign-up'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              Crea tu cuenta y tu local
            </Link>
          </p>
          <p className='text-center text-sm text-muted-foreground'>
            ¿Cuánto cuesta?{' '}
            <Link
              to='/planes'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              Ver planes y precios
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
