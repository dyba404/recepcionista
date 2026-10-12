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
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/password-input'

const MIN_PASSWORD = 8

/**
 * Cambiar contraseña (contrato horarios-pausa-notif-perfil, D): Dialog con
 * tres campos obligatorios (actual, nueva con mín 8 y confirmación);
 * validación client y PATCH /api/auth/me {password_actual, password_nueva}.
 * El 400 "Contraseña actual incorrecta" se muestra VERBATIM inline (regla
 * del contrato); éxito → toast "Contraseña actualizada" (el token JWT
 * sigue válido, no hay relogin).
 */
export function CambiarPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const updateMe = useUpdateMe()

  function guardar() {
    setFormError(null)
    setSaveError(null)
    if (!actual) {
      setFormError('Escribe tu contraseña actual.')
      return
    }
    if (nueva.length < MIN_PASSWORD) {
      setFormError(`La nueva contraseña debe tener ${MIN_PASSWORD} caracteres o más.`)
      return
    }
    if (nueva !== confirmar) {
      setFormError('La confirmación no coincide con la nueva contraseña.')
      return
    }
    updateMe.mutate(
      { password_actual: actual, password_nueva: nueva },
      {
        onSuccess: () => {
          toast.success('Contraseña actualizada')
          setActual('')
          setNueva('')
          setConfirmar('')
          onOpenChange(false)
        },
        onError: (err) => {
          // Verbatim: ej. 400 "Contraseña actual incorrecta".
          setSaveError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            Necesitas tu contraseña actual; la nueva debe tener{' '}
            {MIN_PASSWORD} caracteres o más. Tu sesión sigue abierta.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='pass-actual'>
              Contraseña actual <span className='text-destructive'>*</span>
            </Label>
            <PasswordInput
              id='pass-actual'
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete='current-password'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pass-nueva'>
              Nueva contraseña <span className='text-destructive'>*</span>
            </Label>
            <PasswordInput
              id='pass-nueva'
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              autoComplete='new-password'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pass-confirmar'>
              Confirmar nueva <span className='text-destructive'>*</span>
            </Label>
            <PasswordInput
              id='pass-confirmar'
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete='new-password'
              onKeyDown={(e) => {
                if (e.key === 'Enter') guardar()
              }}
            />
          </div>
        </div>

        {formError && (
          <p className='text-sm text-destructive' role='alert'>
            {formError}
          </p>
        )}
        {saveError && (
          <Alert variant='destructive'>
            <AlertTitle>No se pudo cambiar la contraseña</AlertTitle>
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
            {updateMe.isPending ? 'Cambiando…' : 'Cambiar contraseña'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
