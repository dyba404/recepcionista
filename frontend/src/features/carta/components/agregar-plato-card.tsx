import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Lock, PlusCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, apiErrorDetail } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * "Agregar plato" de la carta admin (contrato saas-cola-2): POST
 * /api/menu/items {tenant, nombre, desc, precio, cat, disponible}. Solo
 * owner; el error del backend (validaciones, 403) se muestra inline tal
 * cual. La invalidación de ['menu', tenant] refresca tabla y chat.
 */
export function AgregarPlatoCard({
  tenant,
  isOwner,
}: {
  tenant: string
  isOwner: boolean
}) {
  const queryClient = useQueryClient()

  const [nombre, setNombre] = useState('')
  const [desc, setDesc] = useState('')
  const [precio, setPrecio] = useState('')
  const [cat, setCat] = useState('Otros')
  const [formError, setFormError] = useState<string | null>(null)

  const addItem = useMutation({
    mutationFn: async (vars: {
      nombre: string
      desc: string
      precio: number
      cat: string
    }) => {
      const res = await api.post('/api/menu/items', {
        tenant,
        nombre: vars.nombre,
        desc: vars.desc,
        precio: vars.precio,
        cat: vars.cat,
        disponible: true,
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['menu', tenant] })
      toast.success(`${vars.nombre} agregado a la carta`)
    },
  })

  function agregar() {
    setFormError(null)
    const nombreLimpio = nombre.trim()
    const precioNum = Number(precio.trim())
    if (!nombreLimpio) {
      setFormError('Escribe el nombre del plato.')
      return
    }
    if (precio.trim() === '' || Number.isNaN(precioNum) || precioNum <= 0) {
      setFormError('Escribe un precio válido, ej. 32.5')
      return
    }
    addItem.mutate(
      {
        nombre: nombreLimpio,
        desc: desc.trim(),
        precio: precioNum,
        cat: cat.trim() || 'Otros',
      },
      {
        onSuccess: () => {
          setNombre('')
          setDesc('')
          setPrecio('')
          setCat('Otros')
        },
        onError: (err) => {
          setFormError(apiErrorDetail(err) ?? err.message)
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <PlusCircle className='size-4 text-primary' />
          Agregar plato
        </CardTitle>
        <CardDescription>
          El plato entra disponible desde ya: el chat de cliente puede
          venderlo al instante.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isOwner && (
          <Alert className='mb-4'>
            <Lock className='size-4' />
            <AlertTitle>Solo el dueño puede hacer esto</AlertTitle>
            <AlertDescription>
              Agregar platos requiere rol owner. Pídele al dueño del local
              que actualice la carta.
            </AlertDescription>
          </Alert>
        )}

        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            agregar()
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='plato-nombre'>
                Nombre <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='plato-nombre'
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder='Ej. Pollo a la brasa'
                disabled={!isOwner || addItem.isPending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='plato-precio'>
                Precio (S/) <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='plato-precio'
                inputMode='decimal'
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder='Ej. 38.9'
                aria-invalid={Boolean(formError)}
                disabled={!isOwner || addItem.isPending}
              />
            </div>
          </div>
          <div className='grid gap-4 sm:grid-cols-[1fr_10rem]'>
            <div className='space-y-2'>
              <Label htmlFor='plato-desc'>Descripción</Label>
              <Input
                id='plato-desc'
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder='Ej. Con papas doradas y ensalada'
                disabled={!isOwner || addItem.isPending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='plato-cat'>Categoría</Label>
              <Input
                id='plato-cat'
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                placeholder='Otros'
                disabled={!isOwner || addItem.isPending}
              />
            </div>
          </div>

          <Button
            type='submit'
            className='gap-1.5'
            disabled={!isOwner || addItem.isPending}
          >
            {addItem.isPending ? (
              <RefreshCw className='size-4 animate-spin' />
            ) : (
              <PlusCircle className='size-4' />
            )}
            {addItem.isPending ? 'Agregando…' : 'Agregar plato'}
          </Button>

          {addItem.isError && formError && (
            <Alert variant='destructive'>
              <AlertTriangle className='size-4' />
              <AlertTitle>No se pudo agregar el plato</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
