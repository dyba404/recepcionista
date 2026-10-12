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
import { RegisterForm } from './components/register-form'

export function SignUp() {
  const { redirect } = useSearch({ from: '/(auth)/sign-up' })

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
            Crea tu cuenta y tu local
          </CardTitle>
          <CardDescription>
            Una sola pantalla: tu cuenta de dueño y el local con el que
            atenderás pedidos por WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4'>
          <RegisterForm redirectTo={redirect} />
          <p className='text-center text-sm text-muted-foreground'>
            ¿Ya tienes cuenta?{' '}
            <Link
              to='/sign-in'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              Inicia sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
