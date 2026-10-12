import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { apiErrorDetail } from '@/lib/api'
import { useUpdateMe } from '@/hooks/use-profile'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Editar nombre (contrato horarios-pausa-notif-perfil, D): Dialog con UN
 * campo obligatorio → PATCH /api/auth/me {nombre}. El éxito refleja el
 * nombre en la sesión (auth-store) y toastea; el error del backend se
 * muestra verbatim inline.
 */
export function EditarNombreDialog({
  open,
  onOpenChange,
  nombreActual,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nombreActual: string
}) {
  const [nombre, setNombre] = useState(nombreActual)
  const [formError, setFormError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const updateMe = useUpdateMe()

  function guardar() {
    setFormError(null)
    setSaveError(null)
    const limpio = nombre.trim()
    if (!limpio) {
      setFormError('Escribe tu nombre, ej. "Ana Torres".')
      return
    }
    updateMe.mutate(
      { nombre: limpio },
      {
        onSuccess: () => {
          toast.success('Nombre actualizado', {
            description: 'Tu perfil ya muestra el nuevo nombre.',
          })
          onOpenChange(false)
        },
        onError: (err) => {
          setSaveError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Editar datos</DialogTitle>
          <DialogDescription>
            Tu nombre es lo que ve el equipo del local.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-2'>
          <Label htmlFor='perfil-nombre'>
            Nombre <span className='text-destructive'>*</span>
          </Label>
          <Input
            id='perfil-nombre'
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder='Ej. Ana Torres'
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardar()
            }}
            aria-invalid={Boolean(formError || saveError) || undefined}
          />
        </div>

        {formError && (
          <p className='text-sm text-destructive' role='alert'>
            {formError}
          </p>
        )}
        {saveError && (
          <Alert variant='destructive'>
            <AlertTitle>No se pudo guardar</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={updateMe.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={updateMe.isPending}>
            {updateMe.isPending && (
              <RefreshCw className='size-4 animate-spin' />
            )}
            {updateMe.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
