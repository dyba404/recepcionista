import { useState } from 'react'
import { Plus, Trash2, Zap } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAddCanned,
  useCanned,
  useDeleteCanned,
} from '@/hooks/use-canned'

/**
 * Picker de respuestas rápidas (canned del tenant) del composer, con
 * gestión inline: insertar al textarea, añadir y eliminar — todo dentro
 * del popover, sin salir del hilo.
 */
export function CannedPicker({
  onPick,
  disabled,
}: {
  onPick: (texto: string) => void
  disabled?: boolean
}) {
  const { data: canned, isPending } = useCanned()
  const addCanned = useAddCanned()
  const deleteCanned = useDeleteCanned()

  const [nuevoShortcut, setNuevoShortcut] = useState('')
  const [nuevoTexto, setNuevoTexto] = useState('')

  function agregar() {
    const shortcut = nuevoShortcut.trim()
    const texto = nuevoTexto.trim()
    if (!shortcut || !texto) return
    addCanned.mutate(
      { shortcut, texto },
      {
        onSuccess: () => {
          setNuevoShortcut('')
          setNuevoTexto('')
        },
      }
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='icon'
          aria-label='Respuestas rápidas'
          disabled={disabled}
          className='size-9 shrink-0'
        >
          <Zap className='size-4' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-96'>
        <div className='space-y-2'>
          <div className='flex items-center gap-1.5 text-sm font-semibold'>
            <Zap className='size-4 text-primary' /> Respuestas rápidas
          </div>

          <div className='max-h-52 space-y-1 overflow-y-auto pe-0.5'>
            {isPending ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))
            ) : (canned ?? []).length === 0 ? (
              <p className='px-1 py-3 text-center text-xs text-muted-foreground'>
                Ninguna todavía — crea la primera abajo.
              </p>
            ) : (
              (canned ?? []).map((c) => (
                <div
                  key={String(c.id)}
                  className='group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent'
                >
                  <button
                    type='button'
                    className='min-w-0 flex-1 text-start'
                    onClick={() => onPick(c.texto)}
                    title={c.texto}
                  >
                    <span className='me-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary'>
                      {c.shortcut}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {c.texto.length > 46
                        ? `${c.texto.slice(0, 46)}…`
                        : c.texto}
                    </span>
                  </button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                    aria-label={`Eliminar ${c.shortcut}`}
                    disabled={deleteCanned.isPending}
                    onClick={() => deleteCanned.mutate(c.id)}
                  >
                    <Trash2 className='size-3.5 text-muted-foreground' />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Separator />

          <div className='space-y-1.5'>
            <div className='flex gap-1.5'>
              <Input
                value={nuevoShortcut}
                onChange={(e) => setNuevoShortcut(e.target.value)}
                placeholder='/atajo'
                className='h-8 w-24 font-mono text-xs'
                aria-label='Atajo de la respuesta rápida'
              />
              <Input
                value={nuevoTexto}
                onChange={(e) => setNuevoTexto(e.target.value)}
                placeholder='Texto de la respuesta…'
                className='h-8 flex-1 text-xs'
                aria-label='Texto de la respuesta rápida'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    agregar()
                  }
                }}
              />
            </div>
            <Button
              size='sm'
              variant='outline'
              className='w-full gap-1'
              disabled={
                addCanned.isPending ||
                !nuevoShortcut.trim() ||
                !nuevoTexto.trim()
              }
              onClick={agregar}
            >
              <Plus className='size-3.5' /> Añadir respuesta
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
