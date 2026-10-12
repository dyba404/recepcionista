import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { KnowledgeEntry } from '@/lib/types'
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
import { Textarea } from '@/components/ui/textarea'

/**
 * Dialog de entrada de la base de conocimiento (contrato
 * carta-inventario-bot): crear (POST /api/kb?tenant= {tema, contenido}) o
 * editar (PATCH /api/kb/{id} {tema, contenido}). tema* y contenido*; el
 * error del backend (422, 403 de manage_settings) se muestra inline tal
 * cual. Los toasts y el cierre los maneja la página con los callbacks de
 * mutate — este dialog solo valida y dispara.
 *
 * El form se hidrata con inicializadores puros: la página lo remonta (key
 * de sesión) cada vez que lo abre — patrón React "reset state with a key",
 * sin efectos.
 */
export function EntradaDialog({
  open,
  onOpenChange,
  /** Entrada en edición; null = crear una nueva. */
  entrada,
  onSubmit,
  isPending,
  /** Error del backend (verbatim) del POST/PATCH; se muestra inline. */
  serverError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entrada: KnowledgeEntry | null
  onSubmit: (vars: { tema: string; contenido: string }) => void
  isPending: boolean
  serverError?: string | null
}) {
  // Inicializadores (se evalúan al remontar con la entrada en edición).
  const [tema, setTema] = useState(() => entrada?.tema ?? '')
  const [contenido, setContenido] = useState(() => entrada?.contenido ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  function guardar() {
    setFormError(null)
    const temaLimpio = tema.trim()
    const contenidoLimpio = contenido.trim()
    if (!temaLimpio) {
      setFormError('Escribe el tema, ej. "Horarios".')
      return
    }
    if (!contenidoLimpio) {
      setFormError('Escribe el contenido de la respuesta.')
      return
    }
    onSubmit({ tema: temaLimpio, contenido: contenidoLimpio })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {entrada ? 'Editar entrada' : 'Nueva entrada'}
          </DialogTitle>
          <DialogDescription>
            {entrada
              ? `Cambios de "${entrada.tema}" — el bot usa la versión guardada al responder.`
              : 'El bot responde horarios, ubicación y promociones desde aquí.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='kb-tema'>
              Tema <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='kb-tema'
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              placeholder='Ej. Horarios'
              disabled={isPending}
            />
            <p className='text-xs text-muted-foreground'>
              Los intents de horario y ubicación buscan entradas cuyo tema
              contenga "horario" o "ubicación".
            </p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='kb-contenido'>
              Contenido <span className='text-destructive'>*</span>
            </Label>
            <Textarea
              id='kb-contenido'
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              placeholder={'Ej. Lun a Dom, 12:00 a 22:00'}
              rows={4}
              aria-invalid={Boolean(formError)}
              disabled={isPending}
            />
          </div>

          {(formError || serverError) && (
            <Alert variant='destructive'>
              <AlertTriangle className='size-4' />
              <AlertTitle>
                {serverError
                  ? 'No se pudo guardar la entrada'
                  : 'Revisa la entrada'}
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
              {isPending ? 'Guardando…' : 'Guardar entrada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
