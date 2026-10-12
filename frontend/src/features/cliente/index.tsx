import { useEffect, useRef, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { RefreshCw, SendHorizontal, WifiOff } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTenants } from '@/hooks/use-tenants'
import { api, apiErrorDetail } from '@/lib/api'
import { penFormatter } from '@/lib/order-utils'
import type {
  ChatCartItem,
  ChatResponse,
  CulqiLink,
  Order,
} from '@/lib/types'
import { botName, EJEMPLOS, platoDemo } from './cliente-utils'
import { CartChip } from './components/cart-chip'
import {
  ChatBubble,
  TypingBubble,
  type ChatMsg,
} from './components/chat-bubble'
import { Paybox } from './components/paybox'

/**
 * Cobro del paybox: en vuelo, con error (reintentable) o listo.
 * Si la orden ya se creó pero el link falló, se guarda para no duplicar
 * el pedido al reintentar (solo se regenera el link de Culqi).
 */
type Cobro =
  | { fase: 'creando' }
  | {
      fase: 'error'
      items: ChatCartItem[]
      dir: string | null
      order?: Order
      mensaje: string
    }
  // conv = token de la conversación a la que pertenece el paybox: si el
  // usuario cambia de local mientras viaja un POST de pago, se descarta.
  | { fase: 'listo'; order: Order; link: CulqiLink; conv: number }

const routeApi = getRouteApi('/_authenticated/cliente/')

/**
 * /cliente — el simulador de WhatsApp: el dueño prueba su bot como si
 * fuera un cliente real (carta → pedido → dirección → pago). Migra el
 * flujo de static/chat.html a React; el estilo es el de la app (Brasa).
 */
export function Cliente() {
  const { tenant: tenantParam } = routeApi.useSearch()
  const navigate = useNavigate()
  const tenantsQuery = useTenants()

  const tenant = tenantParam ?? 'faro'
  const tenantInfo = tenantsQuery.data?.find((t) => t.id === tenant)

  const [customer, setCustomer] = useState('')
  const [input, setInput] = useState('')
  const [mensajes, setMensajes] = useState<ChatMsg[]>([])
  const [cart, setCart] = useState<ChatCartItem[]>([])
  const [direccion, setDireccion] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [cobro, setCobro] = useState<Cobro | null>(null)

  const idRef = useRef(0)
  const listaRef = useRef<HTMLDivElement>(null)
  // Token de conversación: al cambiar de local se incrementa y todo lo que
  // llegue de una petición anterior (chat, cobro, pago) se descarta.
  const convRef = useRef(0)

  const saludo =
    tenantInfo?.saludo ??
    (tenantInfo ? `Hola! Soy ${botName(tenant)}. ¿En qué te ayudo?` : null)

  /** push dentro de la conversación `miConv` (descarta respuestas tardías). */
  function pushDeConv(miConv: number, msg: Omit<ChatMsg, 'id' | 'ts'>) {
    if (miConv !== convRef.current) return
    const id = ++idRef.current
    setMensajes((prev) => [
      ...prev,
      { ...msg, id, ts: new Date().toISOString() },
    ])
  }

  /** Reinicia la conversación al cargar el saludo o al cambiar de local. */
  useEffect(() => {
    if (!saludo) return
    convRef.current += 1
    idRef.current += 1
    setMensajes([
      { id: idRef.current, role: 'bot', text: saludo, ts: new Date().toISOString() },
    ])
    setCart([])
    setDireccion(null)
    setCobro(null)
    setErrorEnvio(null)
    setTyping(false)
    setBusy(false)
    setInput('')
  }, [saludo])

  /** Auto-scroll al último mensaje / indicador de escritura. */
  useEffect(() => {
    const el = listaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [mensajes.length, typing])

  const customerNombre = customer.trim() || 'Cliente'

  /** Envía un mensaje al bot (POST /api/chat) con el carrito actual. */
  async function enviar(textoBruto?: string) {
    const texto = (textoBruto ?? input).trim()
    if (!texto || busy) return
    const miConv = convRef.current
    if (textoBruto === undefined) setInput('')
    const idCliente = ++idRef.current
    setMensajes((prev) => [
      ...prev,
      { id: idCliente, role: 'cliente', text: texto, ts: new Date().toISOString() },
    ])
    setBusy(true)
    setTyping(true)
    setErrorEnvio(null)

    try {
      const res = await api.post<ChatResponse>('/api/chat', {
        tenant,
        customer: customerNombre,
        message: texto,
        cart,
      })
      if (miConv !== convRef.current) return
      const data = res.data
      setCart(data.cart ?? [])
      if (typeof data.direccion === 'string' && data.direccion) {
        setDireccion(data.direccion)
      }
      setTyping(false)
      if (data.foto) pushDeConv(miConv, { role: 'bot', foto: data.foto })
      pushDeConv(miConv, { role: 'bot', text: data.reply })
      if (data.next === 'pago') {
        void crearCobro(
          miConv,
          data.cart ?? [],
          data.direccion || direccion
        )
      }
    } catch {
      if (miConv !== convRef.current) return
      setTyping(false)
      // Quita la burbuja fallida para que Reintentar no la duplique.
      setMensajes((prev) => prev.filter((m) => m.id !== idCliente))
      setErrorEnvio(texto)
    } finally {
      if (miConv === convRef.current) setBusy(false)
    }
  }

  /** Crea la orden + link de Culqi cuando el bot dice next='pago'. */
  async function crearCobro(
    miConv: number,
    items: ChatCartItem[],
    dir: string | null,
    orderExistente?: Order
  ) {
    setCobro({ fase: 'creando' })
    const payload = items.length
      ? items.map((i) => ({ id: i.id, cant: i.cant }))
      : [{ id: platoDemo(tenant), cant: 1 }] // carrito vacío → pedido demo

    let order = orderExistente
    try {
      if (!order) {
        const orderRes = await api.post<Order>('/api/orders', {
          tenant,
          cliente: customerNombre,
          items: payload,
          direccion: dir || 'Sin dirección',
        })
        order = orderRes.data
      }
    } catch (err) {
      if (miConv !== convRef.current) return
      setCobro({
        fase: 'error',
        items,
        dir,
        mensaje:
          apiErrorDetail(err) ??
          'No se pudo crear el pedido. Revisa el servidor y reintenta.',
      })
      return
    }

    try {
      const linkRes = await api.post<CulqiLink>('/api/payments/culqi/link', {
        tenant,
        order_id: order.id,
      })
      if (miConv !== convRef.current) return
      setCobro({ fase: 'listo', order, link: linkRes.data, conv: miConv })
      pushDeConv(miConv, {
        role: 'bot',
        text: `Pedido ${order.id} por ${penFormatter.format(order.total)}. Abajo tienes el QR de Yape y las opciones de cobro.`,
      })
      setCart([]) // el carrito ya vive en el pedido (como el legacy)
    } catch (err) {
      if (miConv !== convRef.current) return
      setCobro({
        fase: 'error',
        items,
        dir,
        order,
        mensaje:
          apiErrorDetail(err) ??
          'No se pudo generar el link de Culqi. Reintenta para regenerarlo.',
      })
    }
  }

  function reintentarEnvio() {
    const texto = errorEnvio
    if (!texto) return
    setErrorEnvio(null)
    void enviar(texto)
  }

  const totalConversacion = mensajes.length

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed className='gap-4'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='font-display text-2xl font-bold tracking-tight'>
              Chat de cliente
            </h2>
            <p className='text-muted-foreground'>
              Simulador WhatsApp: pruébalo como cliente — carta, pedido,
              dirección y pago contra el mismo bot que atiende el local.
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Select
              value={tenant}
              onValueChange={(v) =>
                navigate({ to: '/cliente', search: { tenant: v } })
              }
            >
              <SelectTrigger
                className='w-44'
                aria-label='Local del chat'
              >
                <SelectValue placeholder='Local' />
              </SelectTrigger>
              <SelectContent>
                {(tenantsQuery.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className='w-40'
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder='Tu nombre'
              maxLength={24}
              aria-label='Tu nombre'
            />
          </div>
        </div>

        {tenantsQuery.isError && (
          <Alert variant='destructive'>
            <WifiOff className='size-4' />
            <AlertTitle>No se pudo cargar la lista de locales</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              <span>
                {apiErrorDetail(tenantsQuery.error) ??
                  tenantsQuery.error.message}
              </span>
              <Button
                size='sm'
                variant='outline'
                className='gap-1.5'
                onClick={() => void tenantsQuery.refetch()}
              >
                <RefreshCw className='size-3.5' /> Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Columna central tipo teléfono */}
        <div className='mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-4'>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm'>
            {/* Header del bot */}
            <div className='flex items-center gap-2.5 border-b bg-muted/50 px-3 py-2.5'>
              <Avatar className='size-9 shrink-0'>
                <AvatarFallback className='bg-primary/10 text-sm font-bold text-primary'>
                  {tenantInfo?.nombre.charAt(0) ?? '·'}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-semibold'>
                  {botName(tenant)}
                </p>
                <p className='truncate text-xs text-muted-foreground'>
                  {tenantInfo ? `${tenantInfo.nombre} · ` : ''}
                  en línea · demo
                </p>
              </div>
            </div>

            {/* Carrito visible del último response.cart */}
            {cart.length > 0 && tenantInfo && (
              <CartChip
                cart={cart}
                delivery={tenantInfo.delivery}
                onLimpiar={() => setCart([])}
              />
            )}

            {/* Zona de mensajes */}
            <div
              ref={listaRef}
              className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4'
              aria-live='polite'
            >
              {tenantsQuery.isPending ? (
                <div className='flex flex-1 flex-col justify-end gap-2'>
                  <Skeleton className='h-12 w-2/3 rounded-2xl' />
                  <Skeleton className='ms-auto h-12 w-1/2 rounded-2xl' />
                  <Skeleton className='h-12 w-2/3 rounded-2xl' />
                </div>
              ) : (
                <>
                  {mensajes.map((m) => (
                    <ChatBubble key={m.id} message={m} tenant={tenant} />
                  ))}
                  {typing && <TypingBubble />}

                  {totalConversacion <= 1 && !typing && (
                    <div className='mt-2 flex flex-col items-center gap-1.5 self-center'>
                      <span className='text-[11px] text-muted-foreground'>
                        Prueba con:
                      </span>
                      <div className='flex flex-wrap justify-center gap-1.5'>
                        {EJEMPLOS.map((ej) => (
                          <button
                            key={ej}
                            type='button'
                            className='rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50'
                            disabled={busy}
                            onClick={() => void enviar(ej)}
                          >
                            {ej}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {errorEnvio && (
                    <Alert
                      variant='destructive'
                      className='self-center rounded-xl'
                    >
                      <WifiOff className='size-4' />
                      <AlertTitle>No se pudo enviar</AlertTitle>
                      <AlertDescription className='flex flex-wrap items-center gap-3'>
                        <span>
                          Se cortó la conexión con el servidor. Revisa que
                          siga corriendo y reintenta.
                        </span>
                        <Button
                          size='sm'
                          variant='outline'
                          className='gap-1.5'
                          onClick={reintentarEnvio}
                        >
                          <RefreshCw className='size-3.5' /> Reintentar
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </div>

            {/* Composer */}
            <form
              className='flex items-center gap-2 border-t p-3'
              onSubmit={(e) => {
                e.preventDefault()
                void enviar()
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Escribe: menu · 2 ceviche · confirmar'
                disabled={busy}
                autoComplete='off'
                aria-label='Mensaje'
              />
              <Button
                type='submit'
                size='icon'
                disabled={busy || !input.trim()}
                aria-label='Enviar'
              >
                <SendHorizontal className='size-4' />
              </Button>
            </form>
          </div>

          {/* Paybox bajo el chat cuando el bot pide el pago */}
          {cobro?.fase === 'listo' && (
            <Paybox
              tenant={tenant}
              order={cobro.order}
              link={cobro.link}
              onCliente={(text) =>
                pushDeConv(cobro.conv, { role: 'cliente', text })
              }
              onBot={(text, panel) =>
                pushDeConv(cobro.conv, { role: 'bot', text, panel })
              }
              onTyping={(on) => {
                if (cobro.conv === convRef.current) setTyping(on)
              }}
            />
          )}
          {cobro?.fase === 'creando' && (
            <Skeleton className='h-56 rounded-2xl' />
          )}
          {cobro?.fase === 'error' && (
            <Alert variant='destructive'>
              <RefreshCw className='size-4' />
              <AlertTitle>No se pudo preparar el cobro</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>{cobro.mensaje}</span>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  onClick={() =>
                    void crearCobro(
                      convRef.current,
                      cobro.items,
                      cobro.dir,
                      cobro.order
                    )
                  }
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </Main>
    </>
  )
}
