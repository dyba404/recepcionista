import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, RefreshCw, Trash2, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, apiErrorDetail, isModuleDisabledError } from '@/lib/api'
import type { MenuItem, MenuResponse } from '@/lib/types'
import { useCurrentTenant } from '@/hooks/use-modules'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Main } from '@/components/layout/main'
import { ModuleDisabled } from '@/components/module-disabled'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AgregarPlatoCard } from './components/agregar-plato-card'
import { EditarPlatoDialog } from './components/editar-plato-dialog'

async function fetchMenu(tenant: string): Promise<MenuResponse> {
  const res = await api.get<MenuResponse>('/api/menu', {
    params: { tenant },
  })
  return res.data
}

const penFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
})

export function Carta() {
  const queryClient = useQueryClient()
  const tenant = useCurrentTenant()
  const me = useAuthStore((s) => s.auth.user)
  const isOwner = me?.rol === 'owner'
  const isAdmin = me?.rol === 'admin'
  /** manage_menu (matriz roles-equipo): owner+admin; staff ve candado. */
  const puedeGestionar = isOwner || isAdmin

  // Precio editable por fila (borrador) y error inline por fila
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({})
  // Stock editable por fila (borrador; '' = ∞) y su error inline (contrato
  // carta-inventario-bot)
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({})
  const [stockErrors, setStockErrors] = useState<Record<string, string | null>>(
    {}
  )
  // Plato en edición completa (Dialog) y pendiente de eliminar (ConfirmDialog)
  const [editando, setEditando] = useState<MenuItem | null>(null)
  /** Sesión del dialog de edición: cambia al abrir → el form se hidrata del plato (remount con key, sin efectos). */
  const [sesionEdicion, setSesionEdicion] = useState(0)
  const [pendienteEliminar, setPendienteEliminar] = useState<MenuItem | null>(
    null
  )
  const [eliminarError, setEliminarError] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['menu', tenant],
    queryFn: () => fetchMenu(tenant),
  })

  const savePrecio = useMutation({
    mutationFn: async (vars: { id: string; precio: string }) => {
      const res = await api.post('/api/menu/toggle', {
        tenant,
        id: vars.id,
        precio: vars.precio, // el backend parsea float(precio)
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      setRowErrors((prev) => ({ ...prev, [vars.id]: null }))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[vars.id]
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['menu', tenant] })
      toast.success('Precio actualizado')
    },
    onError: (err, vars) => {
      setRowErrors((prev) => ({
        ...prev,
        [vars.id]: apiErrorDetail(err) ?? err.message,
      }))
    },
  })

  // Stock por fila (contrato carta-inventario-bot): PATCH /api/menu/items
  // {tenant, id, stock}. Vacío se envía como null = volver a ilimitado (la
  // clave viaja en el JSON con valor null, forma que el backend firma como
  // "ilimitado" — nunca ausencia).
  const saveStock = useMutation({
    mutationFn: async (vars: { id: string; stock: number | null }) => {
      const res = await api.patch('/api/menu/items', {
        tenant,
        id: vars.id,
        stock: vars.stock,
      })
      return res.data
    },
    onSuccess: (_data, vars) => {
      setStockErrors((prev) => ({ ...prev, [vars.id]: null }))
      setStockDrafts((prev) => {
        const next = { ...prev }
        delete next[vars.id]
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['menu', tenant] })
      toast.success(
        vars.stock === null
          ? 'Stock: ilimitado (∞)'
          : `Stock actualizado: ${vars.stock}`,
        { description: 'El chat descuenta el stock con cada pedido.' }
      )
    },
    onError: (err, vars) => {
      setStockErrors((prev) => ({
        ...prev,
        [vars.id]: apiErrorDetail(err) ?? err.message,
      }))
    },
  })

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete('/api/menu/items', {
        params: { tenant, id },
      })
      return res.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['menu', tenant] })
      toast.success('Plato eliminado de la carta')
    },
  })

  function eliminar() {
    if (!pendienteEliminar) return
    setEliminarError(null)
    removeItem.mutate(pendienteEliminar.id, {
      onSuccess: () => {
        setPendienteEliminar(null)
        setEliminarError(null)
      },
      onError: (err) => {
        setEliminarError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  function handleSave(item: MenuItem) {
    const raw = (drafts[item.id] ?? String(item.precio)).trim()
    if (raw === '' || Number.isNaN(Number(raw))) {
      setRowErrors((prev) => ({
        ...prev,
        [item.id]: 'Escribe un precio válido, ej. 32.5',
      }))
      return
    }
    savePrecio.mutate({ id: item.id, precio: raw })
  }

  /** Guardar el stock de una fila: '' → null (ilimitado); entero ≥ 0. */
  function handleSaveStock(item: MenuItem) {
    const raw = (
      stockDrafts[item.id] ?? (item.stock == null ? '' : String(item.stock))
    ).trim()
    if (raw === '') {
      saveStock.mutate({ id: item.id, stock: null })
      return
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) {
      setStockErrors((prev) => ({
        ...prev,
        [item.id]: 'Stock inválido: entero ≥ 0 (vacío = ilimitado)',
      }))
      return
    }
    saveStock.mutate({ id: item.id, stock: n })
  }

  const items = data?.items ?? []

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <NotificationsBell />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Carta</h2>
          <p className='text-muted-foreground'>
            Menú de {data?.tenant.nombre ?? '…'} (tenant: {tenant}). Edita el
            precio, el stock (vacío = ilimitado), agrega platos o quítalos; los
            cambios se reflejan al instante.
          </p>
        </div>

        {isError &&
          (isModuleDisabledError(error) ? (
            <ModuleDisabled detail={apiErrorDetail(error)} />
          ) : (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo cargar la carta</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>{error.message}</span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => refetch()}
                  className='gap-1.5'
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ))}

        <div className='mx-auto w-full max-w-5xl'>
          <AgregarPlatoCard tenant={tenant} puedeGestionar={puedeGestionar} />
        </div>

        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader className='bg-muted/50'>
              <TableRow>
                <TableHead className='w-16'>Foto</TableHead>
                <TableHead>Plato</TableHead>
                <TableHead className='w-36'>Categoría</TableHead>
                <TableHead className='w-28'>Precio</TableHead>
                <TableHead className='w-32'>Disponibilidad</TableHead>
                <TableHead className='w-40'>Stock</TableHead>
                <TableHead className='w-56'>Editar precio</TableHead>
                <TableHead className='w-56'>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className='h-6 w-full' />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!isPending &&
                items.map((item) => {
                  const draft = drafts[item.id] ?? String(item.precio)
                  const rowError = rowErrors[item.id] ?? null
                  const stockDraft =
                    stockDrafts[item.id] ??
                    (item.stock == null ? '' : String(item.stock))
                  const stockError = stockErrors[item.id] ?? null
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className='relative flex size-12 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground'>
                          <UtensilsCrossed className='size-5' />
                          {item.foto && (
                            <img
                              src={item.foto}
                              alt={item.nombre}
                              loading='lazy'
                              className='absolute inset-0 size-full object-cover'
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='font-medium'>
                          {item.nombre}
                          {item.stock === 0 && (
                            <Badge
                              variant='destructive'
                              className='ms-2 align-middle'
                            >
                              AGOTADO
                            </Badge>
                          )}
                        </div>
                        <div className='text-sm text-muted-foreground'>
                          {item.desc}
                        </div>
                      </TableCell>
                      <TableCell>{item.cat}</TableCell>
                      <TableCell className='font-medium tabular-nums'>
                        {penFormatter.format(item.precio)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.disponible ? 'default' : 'destructive'}
                          className={
                            item.disponible
                              ? 'bg-emerald-600 text-white'
                              : undefined
                          }
                        >
                          {item.disponible ? 'Disponible' : 'Agotado'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-col gap-1.5'>
                          <div className='flex items-center gap-2'>
                            <Input
                              inputMode='numeric'
                              className='h-8 w-20'
                              value={stockDraft}
                              placeholder='∞'
                              aria-label={`Stock de ${item.nombre} (vacío = ilimitado)`}
                              aria-invalid={Boolean(stockError)}
                              disabled={!puedeGestionar}
                              onChange={(e) =>
                                setStockDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                            />
                            {puedeGestionar ? (
                              <Button
                                size='sm'
                                className='h-8'
                                disabled={
                                  saveStock.isPending &&
                                  saveStock.variables?.id === item.id
                                }
                                onClick={() => handleSaveStock(item)}
                              >
                                Guardar
                              </Button>
                            ) : (
                              <Lock
                                className='size-3.5 text-muted-foreground'
                                aria-label='Requiere rol de dueño o administrador'
                              />
                            )}
                          </div>
                          {stockError && (
                            <p className='text-xs text-destructive'>
                              {stockError}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-col gap-1.5'>
                          <div className='flex items-center gap-2'>
                            <Input
                              inputMode='decimal'
                              className='h-8 w-24'
                              value={draft}
                              aria-invalid={Boolean(rowError)}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              size='sm'
                              className='h-8'
                              disabled={savePrecio.isPending}
                              onClick={() => handleSave(item)}
                            >
                              Guardar
                            </Button>
                          </div>
                          {rowError && (
                            <p className='text-xs text-destructive'>
                              {rowError}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            aria-label={`Editar ${item.nombre}`}
                            className='gap-1.5'
                            disabled={!puedeGestionar}
                            onClick={() => {
                              setEditando(item)
                              setSesionEdicion((s) => s + 1)
                            }}
                          >
                            {!puedeGestionar ? (
                              <Lock className='size-3.5' />
                            ) : (
                              <Pencil className='size-3.5' />
                            )}
                            Editar
                          </Button>
                          <Button
                            variant='outline'
                            size='sm'
                            aria-label={`Eliminar ${item.nombre} de la carta`}
                            className='gap-1.5 text-destructive hover:text-destructive'
                            disabled={!puedeGestionar || removeItem.isPending}
                            onClick={() => {
                              setPendienteEliminar(item)
                              setEliminarError(null)
                            }}
                          >
                            {!puedeGestionar ? (
                              <Lock className='size-3.5' />
                            ) : (
                              <Trash2 className='size-3.5' />
                            )}
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}

              {!isPending && items.length === 0 && !isError && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='h-24 text-center text-muted-foreground'
                  >
                    Sin platos para el tenant {tenant}. Agrega el primero con el
                    formulario de arriba.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Main>

      <ConfirmDialog
        open={pendienteEliminar !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendienteEliminar(null)
            setEliminarError(null)
          }
        }}
        title='Eliminar plato de la carta'
        desc={
          pendienteEliminar
            ? `¿Eliminar "${pendienteEliminar.nombre}" (${penFormatter.format(pendienteEliminar.precio)})? El chat de cliente deja de ofrecerlo de inmediato.`
            : ''
        }
        confirmText='Eliminar'
        destructive
        isLoading={removeItem.isPending}
        handleConfirm={eliminar}
        className='sm:max-w-sm'
      >
        {eliminarError && (
          <p role='alert' className='text-sm font-medium text-destructive'>
            {eliminarError}
          </p>
        )}
      </ConfirmDialog>

      <EditarPlatoDialog
        key={sesionEdicion}
        open={editando !== null}
        onOpenChange={(open) => {
          if (!open) setEditando(null)
        }}
        tenant={tenant}
        item={editando}
      />
    </>
  )
}
