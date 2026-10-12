import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import type { MenuItem } from '@/lib/types'
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
import { Switch } from '@/components/ui/switch'

/**
 * Edición completa del plato (contrato carta-inventario-bot):
 * PATCH /api/menu/items {tenant, id, nombre, desc, precio, cat, disponible,
 * stock}. El stock vacío se envía como null (clave presente con valor JSON
 * null) — así el backend distingue "volver a ilimitado" de "no tocar stock".
 * Los errores del backend (403 de manage_menu, validaciones) se muestran
 * inline tal cual; el éxito invalida ['menu', tenant] (tabla + chat).
 *
 * El form se hidrata con inicializadores puros: la página lo remonta (key
 * de sesión) cada vez que abre una edición — patrón React "reset state with
 * a key", sin efectos.
 */
export function EditarPlatoDialog({
  open,
  onOpenChange,
  tenant,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant: string
  /** Plato en edición; null cuando el dialog está cerrado. */
  item: MenuItem | null
}) {
  const queryClient = useQueryClient()

  // Inicializadores (se evalúan al remontar con el plato en edición):
  // stock null → input vacío (= ∞, se reenvía como null).
  const [nombre, setNombre] = useState(() => item?.nombre ?? '')
  const [desc, setDesc] = useState(() => item?.desc ?? '')
  const [precio, setPrecio] = useState(() => (item ? String(item.precio) : ''))
  const [cat, setCat] = useState(() => item?.cat ?? '')
  const [stock, setStock] = useState(() =>
    item == null || item.stock == null ? '' : String(item.stock)
  )
  const [disponible, setDisponible] = useState(() => item?.disponible ?? true)
  const [formError, setFormError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const updateItem = useMutation({
    mutationFn: async (vars: {
      nombre: string
      desc: string
      precio: number
      cat: string
      disponible: boolean
      stock: number | null
    }) => {
      if (!item) throw new Error('No hay plato en edición')
      const res = await api.patch('/api/menu/items', {
        tenant,
        id: item.id,
        nombre: vars.nombre,
        desc: vars.desc,
        precio: vars.precio,
        cat: vars.cat,
        disponible: vars.disponible,
        stock: vars.stock, // null = ilimitado (la clave SÍ viaja en el JSON)
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['menu', tenant] })
      toast.success('Plato actualizado', {
        description: 'La carta y el chat de cliente ya lo reflejan.',
      })
      onOpenChange(false)
    },
  })

  function guardar() {
    if (!item) return
    setFormError(null)
    setMutationError(null)
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      setFormError('Escribe el nombre del plato.')
      return
    }
    const precioNum = Number(precio.trim())
    if (precio.trim() === '' || Number.isNaN(precioNum) || precioNum <= 0) {
      setFormError('Escribe un precio válido, ej. 32.5')
      return
    }
    const stockLimpio = stock.trim()
    let stockValor: number | null
    if (stockLimpio === '') {
      stockValor = null // vacío = ilimitado
    } else {
      const n = Number(stockLimpio)
      if (!Number.isInteger(n) || n < 0) {
        setFormError(
          'El stock debe ser un entero mayor o igual a 0 (o vacío para ilimitado).'
        )
        return
      }
      stockValor = n
    }
    updateItem.mutate(
      {
        nombre: nombreLimpio,
        desc: desc.trim(),
        precio: precioNum,
        cat: cat.trim() || 'Otros',
        disponible,
        stock: stockValor,
      },
      {
        onError: (err) => {
          setMutationError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  /** Error a mostrar: el del backend (verbatim) si hay, si no el de validación. */
  const errorMostrado = mutationError ?? formError

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Editar plato</DialogTitle>
          <DialogDescription>
            {item
              ? `Cambios de "${item.nombre}" — se reflejan al instante en la carta y el chat de cliente.`
              : ''}
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
            <Label htmlFor='editar-nombre'>
              Nombre <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='editar-nombre'
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder='Ej. Pollo a la brasa'
              disabled={updateItem.isPending}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='editar-desc'>Descripción</Label>
            <Input
              id='editar-desc'
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder='Ej. Con papas doradas y ensalada'
              disabled={updateItem.isPending}
            />
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='editar-precio'>
                Precio (S/) <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='editar-precio'
                inputMode='decimal'
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder='Ej. 38.9'
                aria-invalid={Boolean(errorMostrado)}
                disabled={updateItem.isPending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='editar-cat'>Categoría</Label>
              <Input
                id='editar-cat'
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                placeholder='Otros'
                disabled={updateItem.isPending}
              />
            </div>
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='editar-stock'>Stock</Label>
              <Input
                id='editar-stock'
                inputMode='numeric'
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder='∞'
                disabled={updateItem.isPending}
              />
              <p className='text-xs text-muted-foreground'>
                Vacío = ilimitado. En 0 el chat lo muestra como agotado.
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='editar-disponible'>Disponible</Label>
              <div className='flex h-9 items-center gap-2'>
                <Switch
                  id='editar-disponible'
                  checked={disponible}
                  onCheckedChange={setDisponible}
                  disabled={updateItem.isPending}
                />
                <span className='text-sm text-muted-foreground'>
                  {disponible ? 'Se ofrece en el chat' : 'Oculto en el chat'}
                </span>
              </div>
            </div>
          </div>

          {errorMostrado && (
            <Alert variant='destructive'>
              <AlertTriangle className='size-4' />
              <AlertTitle>No se pudo guardar el plato</AlertTitle>
              <AlertDescription>{errorMostrado}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={updateItem.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={updateItem.isPending}>
              {updateItem.isPending ? (
                <RefreshCw className='size-4 animate-spin' />
              ) : null}
              {updateItem.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
