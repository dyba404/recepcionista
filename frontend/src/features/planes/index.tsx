import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import type { PlanInfo } from '@/lib/types'
import { usePlanes, useCambiarPlan } from '@/hooks/use-planes'
import { useTenants } from '@/hooks/use-tenants'
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AuthLayout } from '@/features/auth/auth-layout'

/**
 * Los tres planes del contrato endurecer-local (sección E) — sirven de
 * fallback honesto si GET /api/planes no responde (el backend los publica
 * igual).
 */
const PLANES_FALLBACK: PlanInfo[] = [
  { id: 'trial', nombre: 'Prueba', precio: 0, detalle: '14 días completos' },
  { id: 'basico', nombre: 'Básico', precio: 49, detalle: '1 local + chatbot + inbox' },
  { id: 'pro', nombre: 'Pro', precio: 99, detalle: '+ KDS, ledger, plantillas' },
]

/**
 * /planes — pricing pública (contrato endurecer-local, sección E): sin
 * auth, accesible desde el landing (sign-in) y linkeada desde ahí. Con
 * sesión, el CTA de Básico/Pro hace PATCH /api/tenants/{miTenant}/plan
 * (activación manual — el cobro automático llega con Culqi Suscripciones)
 * y marca "Plan actual" el que coincide; sin sesión, manda a /sign-up.
 */
export function Planes() {
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.auth.user)
  const {
    data: planesData,
    isPending,
    isError,
    error,
    refetch,
  } = usePlanes()
  const { data: tenants } = useTenants()
  const cambiarPlan = useCambiarPlan()

  /** Plan del local de la sesión (GET /api/tenants trae plan/trial_hasta). */
  const miPlan = me?.tenant_id
    ? (tenants ?? []).find((t) => t.id === me.tenant_id)?.plan
    : undefined

  const planes = planesData ?? PLANES_FALLBACK

  function activar(plan: PlanInfo) {
    if (!me?.tenant_id) {
      // sin sesión: crear cuenta primero (la prueba arranca ahí)
      navigate({ to: '/sign-up' })
      return
    }
    cambiarPlan.mutate({ tenant: me.tenant_id, plan: String(plan.id) })
  }

  return (
    <AuthLayout>
      <div className='mx-auto flex w-full max-w-5xl flex-col items-center gap-8'>
        <div className='flex flex-col items-center gap-3 text-center'>
          <div className='flex items-center gap-2.5'>
            <BrandLogo className='size-9 rounded-lg' />
            <span className='font-display text-lg font-bold tracking-tight'>
              Recepcionista
            </span>
          </div>
          <h1 className='font-display text-3xl font-bold tracking-tight'>
            Planes y precios
          </h1>
          <p className='max-w-xl text-muted-foreground'>
            Empieza con la prueba de 14 días y crece cuando tu local lo pida.
            La activación hoy es manual — el cobro automático llega con Culqi
            Suscripciones.
          </p>
        </div>

        {isError && (
          <Alert variant='destructive' className='w-full'>
            <AlertTitle>No se pudo cargar la lista del servidor</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>
                {error.message} — mientras, estos son los planes publicados.
              </span>
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

        {isPending ? (
          <div className='grid w-full gap-4 md:grid-cols-3'>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-64 rounded-xl' />
            ))}
          </div>
        ) : (
          <div className='grid w-full gap-4 md:grid-cols-3'>
            {planes.map((plan) => {
              const actual = String(plan.id) === miPlan
              const esTrial = plan.id === 'trial'
              const activando =
                cambiarPlan.isPending &&
                cambiarPlan.variables?.plan === plan.id
              return (
                <Card
                  key={String(plan.id)}
                  className={cn(
                    'relative gap-4',
                    actual && 'border-primary shadow-sm'
                  )}
                >
                  {actual && (
                    <Badge className='absolute -top-2.5 start-4 bg-primary text-primary-foreground'>
                      Plan actual
                    </Badge>
                  )}
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      {plan.id === 'pro' && (
                        <Sparkles className='size-4 text-primary' />
                      )}
                      {plan.nombre}
                    </CardTitle>
                    <div className='flex items-baseline gap-1'>
                      <span className='text-3xl font-bold tabular-nums'>
                        S/ {plan.precio}
                      </span>
                      <span className='text-sm text-muted-foreground'>
                        {esTrial ? '/ 14 días' : '/ mes'}
                      </span>
                    </div>
                    <CardDescription>{plan.detalle}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {esTrial ? (
                      actual ? (
                        <Button variant='outline' className='w-full' disabled>
                          Ya estás en la prueba
                        </Button>
                      ) : (
                        <p className='text-xs text-muted-foreground'>
                          Se activa sola al crear tu cuenta y tu local — con
                          todo el producto, sin tarjeta.
                        </p>
                      )
                    ) : actual ? (
                      <Button variant='outline' className='w-full' disabled>
                        Plan actual
                      </Button>
                    ) : (
                      <Button
                        className='w-full gap-1.5'
                        disabled={activando}
                        onClick={() => activar(plan)}
                      >
                        {activando ? (
                          <Loader2 className='size-4 animate-spin' />
                        ) : null}
                        {me
                          ? `Activar ${plan.nombre}`
                          : 'Crear cuenta y activar'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        <p className='text-center text-sm text-muted-foreground'>
          {me ? (
            <>
              {'¿Volver al panel? '}
              <Link
                to='/'
                className='font-medium text-primary underline-offset-4 hover:underline'
              >
                Ir a mi resumen
              </Link>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{' '}
              <Link
                to='/sign-in'
                className='font-medium text-primary underline-offset-4 hover:underline'
              >
                Inicia sesión
              </Link>
            </>
          )}
        </p>
      </div>
    </AuthLayout>
  )
}
