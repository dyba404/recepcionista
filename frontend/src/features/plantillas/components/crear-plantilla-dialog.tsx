import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/**
 * Dialog de crear plantilla WhatsApp (contrato endurecer-local, sección D):
 * POST /api/whatsapp/plantillas {tenant, nombre, categoria, lenguaje,
 * cuerpo}. nombre* con el patrón de Meta [a-z0-9_], categoría (MARKETING /
 * UTILITY / AUTHENTICATION), lenguaje (es/en) y cuerpo* con nota de
 * variables {{1}}. El error del backend (422 de Meta, 403 de
 * manage_settings) se muestra inline verbatim; los toasts y el cierre los
 * maneja la página — este dialog solo valida y dispara.
 *
 * El form se hidrata con inicializadores puros: la página lo remonta (key
 * de sesión) cada vez que lo abre — patrón "reset state with a key".
 */
export function CrearPlantillaDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  /** Error del backend (verbatim) del POST; se muestra inline. */
  serverError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (vars: {
    nombre: string
    categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
    lenguaje: 'es' | 'en'
    cuerpo: string
  }) => void
  isPending: boolean
  serverError?: string | null
}) {
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState<
    'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  >('MARKETING')
  const [lenguaje, setLenguaje] = useState<'es' | 'en'>('es')
  const [cuerpo, setCuerpo] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function guardar() {
    setFormError(null)
    const nombreLimpio = nombre.trim()
    if (!/^[a-z0-9_]+$/.test(nombreLimpio)) {
      setFormError(
        'El nombre solo admite minúsculas, dígitos y guion bajo, ej. pedido_listo.'
      )
      return
    }
    if (!cuerpo.trim()) {
      setFormError('Escribe el cuerpo del mensaje.')
      return
    }
    onSubmit({
      nombre: nombreLimpio,
      categoria,
      lenguaje,
      cuerpo: cuerpo.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nueva plantilla</DialogTitle>
          <DialogDescription>
            Se crea en Meta y queda espejada aquí con el estado que Meta
            devuelva (en el sandbox puede quedar en revisión).
          </DialogDescription>
        </DialogHeader>

        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='plantilla-nombre'>
                Nombre <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='plantilla-nombre'
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder='pedido_listo'
                className='font-mono'
                aria-invalid={Boolean(formError)}
                disabled={isPending}
              />
              <p className='text-xs text-muted-foreground'>
                Meta lo valida: solo minúsculas, dígitos y _.
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='plantilla-categoria'>Categoría</Label>
              <Select
                value={categoria}
                onValueChange={(v) =>
                  setCategoria(v as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')
                }
                disabled={isPending}
              >
                <SelectTrigger id='plantilla-categoria' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='MARKETING'>Marketing</SelectItem>
                  <SelectItem value='UTILITY'>Utilidad</SelectItem>
                  <SelectItem value='AUTHENTICATION'>Autenticación</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='plantilla-lenguaje'>Lenguaje</Label>
            <Select
              value={lenguaje}
              onValueChange={(v) => setLenguaje(v as 'es' | 'en')}
              disabled={isPending}
            >
              <SelectTrigger id='plantilla-lenguaje' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='es'>Español (es)</SelectItem>
                <SelectItem value='en'>Inglés (en)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='plantilla-cuerpo'>
              Cuerpo <span className='text-destructive'>*</span>
            </Label>
            <Textarea
              id='plantilla-cuerpo'
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              placeholder='Ej. ¡Hola {{1}}! Tu pedido {{2}} ya salió del horno.'
              rows={5}
              aria-invalid={Boolean(formError)}
              disabled={isPending}
            />
            <p className='text-xs text-muted-foreground'>
              Usa {'{{1}}'}, {'{{2}}'}… para las variables — se rellenan al
              enviar el mensaje.
            </p>
          </div>

          {(formError || serverError) && (
            <Alert variant='destructive'>
              <AlertTriangle className='size-4' />
              <AlertTitle>
                {serverError
                  ? 'No se pudo crear la plantilla'
                  : 'Revisa la plantilla'}
              </AlertTitle>
              <AlertDescription>{serverError ?? formError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? <RefreshCw className='size-4 animate-spin' /> : null}
              {isPending ? 'Creando…' : 'Crear plantilla'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
