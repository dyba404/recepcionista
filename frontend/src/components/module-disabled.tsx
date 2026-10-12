import { Link } from '@tanstack/react-router'
import { PowerOff } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Estado inline para páginas bloqueadas por módulo apagado: el backend
 * responde 403 con `detail` "Módulo desactivado: actívalo en
 * Configuración" — lo mostramos tal cual, con atajo directo a
 * Configuración → Módulos.
 */
export function ModuleDisabled({
  detail,
  className,
}: {
  detail?: string
  className?: string
}) {
  return (
    <Alert className={cn('border-amber-500/40', className)}>
      <PowerOff className='size-4 text-amber-600 dark:text-amber-400' />
      <AlertTitle>Módulo desactivado</AlertTitle>
      <AlertDescription className='flex flex-wrap items-center gap-3'>
        <span>
          {detail ??
            'Módulo desactivado: actívalo en Configuración para usar esta página.'}
        </span>
        <Button asChild size='sm' variant='outline' className='shrink-0'>
          <Link to='/configuracion/modulos'>
            Ir a Configuración → Módulos
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  )
}
