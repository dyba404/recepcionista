import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Botón copiar de los datos de la app (app_id, waba_id, verify_token). */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  label: string
  className?: string
}) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(value)
      setCopiado(true)
      toast.success(`${label} copiado`)
      window.setTimeout(() => setCopiado(false), 1_500)
    } catch {
      toast.error('No se pudo copiar — selecciónalo a mano')
    }
  }

  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className={cn('size-7 shrink-0', className)}
      aria-label={`Copiar ${label}`}
      onClick={() => void copiar()}
      disabled={!value}
    >
      {copiado ? (
        <Check className='size-3.5 text-emerald-600' />
      ) : (
        <Copy className='size-3.5' />
      )}
    </Button>
  )
}
