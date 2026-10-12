import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Marca "Recepcionista": cuadradito con gradiente tomate + llama.
 * Se usa en el sidebar, el sign-in y el favicon (mismo motivo).
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#E05A33] to-[#8F2D12] text-[#FFF8EF] shadow-xs',
        className
      )}
      aria-hidden='true'
    >
      <Flame className='size-4' />
    </div>
  )
}
