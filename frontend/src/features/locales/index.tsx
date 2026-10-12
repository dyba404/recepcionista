import { RefreshCw, Store } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDemoReset } from '@/hooks/use-demo-reset'
import { useTenants } from '@/hooks/use-tenants'
import { TenantCard } from './components/tenant-card'

export function Locales() {
  const { data, isPending, isError, error, refetch } = useTenants()
  const demoReset = useDemoReset()

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <NotificationsBell />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='font-display text-2xl font-bold tracking-tight'>
              Locales
            </h2>
            <p className='text-muted-foreground'>
              Los 3 locales del demo. Abre el chat de cliente (simulador
              WhatsApp) o entra al panel de cada local.
            </p>
          </div>
          {demoReset.isOwner && (
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              disabled={demoReset.isPending}
              onClick={() => demoReset.mutate()}
            >
              <RefreshCw className='size-3.5' /> Recargar demo
            </Button>
          )}
        </div>

        {isError && (
          <Alert variant='destructive'>
            <Store className='size-4' />
            <AlertTitle>No se pudo cargar la lista de locales</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>{error.message}</span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => refetch()}
                className='gap-1.5'
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {isPending &&
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-96 rounded-xl' />
            ))}

          {data?.map((tenant) => (
            <TenantCard key={tenant.id} tenant={tenant} />
          ))}
        </div>

        {!isPending && !isError && (data?.length ?? 0) === 0 && (
          <p className='text-muted-foreground'>
            No hay locales registrados todavía.
          </p>
        )}
      </Main>
    </>
  )
}
