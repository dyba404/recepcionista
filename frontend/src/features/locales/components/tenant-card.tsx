import { MapPin, UtensilsCrossed } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { Tenant } from '@/lib/types'
import { penFormatter, tenantFoto } from '@/lib/order-utils'

interface TenantCardProps {
  tenant: Tenant
}

export function TenantCard({ tenant }: TenantCardProps) {
  return (
    <Card className='flex flex-col overflow-hidden pt-0'>
      <div className='relative flex h-40 items-center justify-center border-b bg-muted text-muted-foreground'>
        <UtensilsCrossed className='size-8' aria-hidden />
        <img
          src={tenantFoto(tenant.id)}
          alt={tenant.nombre}
          loading='lazy'
          className='absolute inset-0 size-full object-cover'
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='text-base'>{tenant.nombre}</CardTitle>
          <Badge variant='outline' className='shrink-0 gap-1'>
            <MapPin className='size-3' /> {tenant.distrito}
          </Badge>
        </div>
        <CardDescription className='capitalize'>
          {tenant.rubro}
        </CardDescription>
      </CardHeader>
      <CardContent className='grid flex-1 content-start gap-2 text-sm'>
        <div className='grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-center'>
          <div>
            <p className='font-semibold tabular-nums'>
              {penFormatter.format(tenant.delivery)}
            </p>
            <p className='text-xs text-muted-foreground'>delivery</p>
          </div>
          <div>
            <p className='font-semibold'>{tenant.tiempo}</p>
            <p className='text-xs text-muted-foreground'>entrega</p>
          </div>
          <div>
            <p className='font-semibold tabular-nums'>
              {(tenant.culqi_comision * 100).toFixed(2)}%
            </p>
            <p className='text-xs text-muted-foreground'>Culqi</p>
          </div>
        </div>
        <p className='font-mono text-xs text-muted-foreground'>
          Yape {tenant.yape_qr}
        </p>
      </CardContent>
      <CardFooter className='flex-col gap-2'>
        <Button className='w-full' asChild>
          <Link to='/cliente' search={{ tenant: tenant.id }}>
            Abrir chat de cliente
          </Link>
        </Button>
        <Button variant='outline' className='w-full' asChild>
          <Link to='/panel' search={{ tenant: tenant.id }}>
            Ver panel
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
