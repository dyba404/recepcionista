import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Inbox, Search, SearchX } from 'lucide-react'
import type { Conversation } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'
import { porReciente } from '../inbox-utils'
import { ConversationItem } from './conversation-item'

type FiltroEstado = 'todas' | 'bot' | 'humano' | 'resuelta'

const FILTROS: { value: FiltroEstado; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'bot', label: 'Bot' },
  { value: 'humano', label: 'Humano' },
  { value: 'resuelta', label: 'Resueltas' },
]

/**
 * Panel izquierdo del inbox: búsqueda, filtros por estado con contadores,
 * "solo mías" y la lista de conversaciones. Los filtros se derivan de la
 * misma query canónica (['conversations', tenant]) que alimenta el badge
 * del sidebar — una sola fuente, cajan refetches extra.
 */
export function ConversationList({
  conversations,
  isPending,
  selectedId,
  onSelect,
  className,
}: {
  conversations: Conversation[] | undefined
  isPending: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
}) {
  const me = useAuthStore((s) => s.auth.user)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<FiltroEstado>('todas')
  const [soloMias, setSoloMias] = useState(false)

  const ordenadas = useMemo(
    () => [...(conversations ?? [])].sort(porReciente),
    [conversations]
  )

  const contadores = useMemo(() => {
    const base: Record<FiltroEstado, number> = {
      todas: ordenadas.length,
      bot: 0,
      humano: 0,
      resuelta: 0,
    }
    for (const c of ordenadas) {
      if (c.estado === 'bot') base.bot += 1
      else if (c.estado === 'humano') base.humano += 1
      else if (c.estado === 'resuelta') base.resuelta += 1
    }
    return base
  }, [ordenadas])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return ordenadas.filter((c) => {
      if (filtro !== 'todas' && c.estado !== filtro) return false
      if (soloMias && String(c.assigned_to ?? '') !== String(me?.id ?? ''))
        return false
      if (!q) return true
      return (
        c.cliente.toLowerCase().includes(q) || c.wa_id.toLowerCase().includes(q)
      )
    })
  }, [ordenadas, filtro, soloMias, busqueda, me])

  return (
    <div
      className={cn(
        'min-h-0 flex-col overflow-hidden rounded-lg border bg-card',
        className
      )}
    >
      <div className='flex flex-col gap-2.5 border-b p-3'>
        <div className='relative'>
          <Search className='absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder='Buscar por nombre o teléfono…'
            className='ps-8'
            aria-label='Buscar conversaciones'
          />
        </div>

        <div
          className='flex flex-wrap gap-1'
          role='group'
          aria-label='Filtrar por estado'
        >
          {FILTROS.map((f) => {
            const activo = filtro === f.value
            return (
              <button
                key={f.value}
                type='button'
                onClick={() => setFiltro(f.value)}
                aria-pressed={activo}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  activo
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                )}
              >
                {f.label}{' '}
                <span className='tabular-nums opacity-80'>
                  ({contadores[f.value]})
                </span>
              </button>
            )
          })}
        </div>

        <div className='flex items-center justify-between gap-2'>
          <Label
            htmlFor='inbox-solo-mias'
            className='cursor-pointer text-xs text-muted-foreground'
          >
            Solo mías
          </Label>
          <Switch
            id='inbox-solo-mias'
            checked={soloMias}
            onCheckedChange={setSoloMias}
            aria-label='Ver solo mis conversaciones'
            className='scale-90'
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto p-1.5'>
        {isPending ? (
          <div className='space-y-2 p-1.5'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className='flex items-center gap-3 px-2 py-2'>
                <Skeleton className='size-9 rounded-full' />
                <div className='flex-1 space-y-1.5'>
                  <Skeleton className='h-3.5 w-2/3' />
                  <Skeleton className='h-3 w-5/6' />
                </div>
              </div>
            ))}
          </div>
        ) : (conversations ?? []).length === 0 ? (
          <EmptyConversaciones />
        ) : filtradas.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'>
            <SearchX className='size-8 text-muted-foreground/50' />
            <p className='text-sm font-medium'>Nada por aquí</p>
            <p className='text-xs text-muted-foreground'>
              Prueba con otro nombre o quita los filtros.
            </p>
          </div>
        ) : (
          <div className='space-y-0.5'>
            {filtradas.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyConversaciones() {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'>
      <Inbox className='size-8 text-muted-foreground/50' />
      <p className='text-sm font-medium'>Sin conversaciones todavía</p>
      <p className='max-w-56 text-xs text-muted-foreground'>
        Cuando un cliente escriba por WhatsApp o el simulador, la
        conversación cae aquí al instante.
      </p>
      <Button asChild variant='outline' size='sm' className='mt-1'>
        <Link to='/configuracion/whatsapp'>Conectar WhatsApp</Link>
      </Button>
    </div>
  )
}
