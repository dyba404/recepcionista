import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PasoWizard = {
  titulo: string
  desc: string
}

/**
 * Stepper horizontal del wizard (3 pasos, navegación libre): círculo
 * numerado → check cuando el paso queda atrás, línea conectora entre
 * pasos.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
}: {
  steps: PasoWizard[]
  current: number
  onStepClick: (index: number) => void
}) {
  return (
    <ol className='flex w-full items-center gap-3' aria-label='Progreso'>
      {steps.map((paso, i) => {
        const hecho = i < current
        const activo = i === current
        return (
          <li key={paso.titulo} className='flex min-w-0 flex-1 items-center gap-3'>
            <button
              type='button'
              onClick={() => onStepClick(i)}
              aria-current={activo ? 'step' : undefined}
              className='group flex min-w-0 items-center gap-2.5 text-left'
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                  hecho &&
                    'border-primary bg-primary text-primary-foreground',
                  activo && 'border-primary text-primary',
                  !hecho &&
                    !activo &&
                    'border-muted-foreground/30 text-muted-foreground group-hover:border-muted-foreground/60'
                )}
              >
                {hecho ? <Check className='size-4' /> : i + 1}
              </span>
              <span className='min-w-0'>
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    activo ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {paso.titulo}
                </span>
                <span className='hidden truncate text-xs text-muted-foreground sm:block'>
                  {paso.desc}
                </span>
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-px flex-1',
                  i < current ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
