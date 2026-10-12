import {
  Blocks,
  BookOpen,
  Bot,
  BrainCircuit,
  ChefHat,
  ClipboardList,
  Clock,
  Code,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  MessageCircle,
  Palette,
  PlugZap,
  Settings,
  Store,
  UserCog,
  Users,
} from 'lucide-react'
import { type SidebarData } from '../types'

/**
 * Nav del producto (ADR 0002 + modulos-mvp):
 * - General: Resumen (dashboard), Locales y el simulador de chat cliente.
 * - Mensajería: Inbox (handoff humano
 *   con badge de no leídos — inyectado en vivo desde AppSidebar).
 * - Gestión: Panel kanban de pedidos, Cocina (KDS) y Carta.
 * - Configuración: Ajustes (perfil/apariencia), Canal de WhatsApp,
 *   Base de conocimiento y Asistente (carta-inventario-bot: el bot
 *   responde horarios/ubicación/promos desde la KB y habla con el tono
 *   elegido), Pasarela de pagos (Culqi), Equipo (staff del local,
 *   saas-cola-2) y Módulos (toggles owner).
 * - Ayuda: enlaces reales del template (repo e issues de shadcn-admin).
 *
 * El gating por módulos (ocultar Mensajería/Cocina/Carta) lo aplica
 * AppSidebar con use-modules; aquí viven TODOS los ítems (el command
 * menu también consume esta data).
 */
export const sidebarData: SidebarData = {
  user: {
    name: 'Recepcionista',
    email: 'admin@demo.pe',
    avatar: '',
  },
  navGroups: [
    {
      title: 'General',
      items: [
        {
          title: 'Resumen',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Locales',
          url: '/locales',
          icon: Store,
        },
        {
          // Simulador de chat cliente (demo) — página interna /cliente,
          // reemplaza al legacy público en :8000/chat.
          title: 'Chat de cliente',
          url: '/cliente',
          icon: MessageCircle,
          badge: 'demo',
        },
      ],
    },
    {
      title: 'Mensajería',
      items: [
        {
          title: 'Inbox',
          url: '/mensajeria/inbox',
          icon: Inbox,
        },
      ],
    },
    {
      title: 'Gestión',
      items: [
        {
          title: 'Panel de pedidos',
          url: '/panel',
          icon: ClipboardList,
        },
        {
          title: 'Cocina',
          url: '/cocina',
          icon: ChefHat,
        },
        {
          title: 'Carta',
          url: '/carta',
          icon: BookOpen,
        },
      ],
    },
    {
      title: 'Configuración',
      items: [
        {
          title: 'Ajustes',
          icon: Settings,
          items: [
            {
              title: 'Perfil',
              url: '/settings/profile',
              icon: UserCog,
            },
            {
              title: 'Apariencia',
              url: '/settings/appearance',
              icon: Palette,
            },
          ],
        },
        {
          title: 'Canal de WhatsApp',
          url: '/configuracion/whatsapp',
          icon: PlugZap,
        },
        {
          // Base de conocimiento (carta-inventario-bot): horarios, ubicación
          // y promos que el bot responde desde aquí.
          title: 'Base de conocimiento',
          url: '/configuracion/conocimiento',
          icon: BrainCircuit,
        },
        {
          // Asistente (carta-inventario-bot): nombre, saludo, tono e
          // instrucciones extra del bot.
          title: 'Asistente',
          url: '/configuracion/asistente',
          icon: Bot,
        },
        {
          // Horarios de atención (horarios-pausa-notif-perfil): Lun..Dom,
          // el bot no toma pedidos fuera de horario.
          title: 'Horarios',
          url: '/configuracion/horarios',
          icon: Clock,
        },
        {
          title: 'Pasarela de pagos',
          url: '/configuracion/pagos',
          icon: CreditCard,
        },
        {
          title: 'Equipo',
          url: '/configuracion/equipo',
          icon: Users,
        },
        {
          title: 'Módulos',
          url: '/configuracion/modulos',
          icon: Blocks,
        },
      ],
    },
    {
      title: 'Ayuda',
      items: [
        {
          title: 'Soporte',
          url: 'https://github.com/satnaing/shadcn-admin/issues',
          icon: LifeBuoy,
        },
        {
          title: 'Repositorio',
          url: 'https://github.com/satnaing/shadcn-admin',
          icon: Code,
        },
      ],
    },
  ],
}
