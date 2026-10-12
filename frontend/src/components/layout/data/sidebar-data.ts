import {
  Blocks,
  BookOpen,
  ChefHat,
  ClipboardList,
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
} from 'lucide-react'
import { type SidebarData } from '../types'

/**
 * Nav del producto (ADR 0002 + modulos-mvp):
 * - General: Resumen (dashboard), Locales y el simulador de chat cliente.
 * - Mensajería: Inbox (handoff humano
 *   con badge de no leídos — inyectado en vivo desde AppSidebar).
 * - Gestión: Panel kanban de pedidos, Cocina (KDS) y Carta.
 * - Configuración: Ajustes (perfil/apariencia), Canal de WhatsApp,
 *   Pasarela de pagos (Culqi) y Módulos (toggles owner).
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
          title: 'Pasarela de pagos',
          url: '/configuracion/pagos',
          icon: CreditCard,
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
