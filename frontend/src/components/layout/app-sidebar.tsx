import { useMemo } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { BrandHeader } from './brand-header'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import type { NavGroup as NavGroupProps } from './types'
import { useModules, MODULE_KEYS } from '@/hooks/use-modules'
import { useOrdersWs } from '@/hooks/use-orders-ws'
import { useUnreadTotal } from '@/hooks/use-conversations'

const GRUPO_MENSAJERIA = 'Mensajería'
const GRUPO_GESTION = 'Gestión'

/**
 * Sidebar con gating de módulos y badge de no leídos en vivo:
 * - El grupo "Mensajería" desaparece si whatsapp+inbox están apagados;
 *   "Cocina" y "Carta" se ocultan si kds/carta están apagados
 *   (fail-open mientras carga la lista de módulos).
 * - El badge del Inbox suma el `unread` de todas las conversaciones
 *   (query inicial GET + invalidación por WS message.created /
 *   conversation.updated, gracias al singleton de useOrdersWs montado
 *   aquí — la conexión vive mientras exista el sidebar).
 */
export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const authUser = useAuthStore((s) => s.auth.user)
  const { isEnabled } = useModules()
  useOrdersWs() // conexión live compartida por todas las páginas
  const unread = useUnreadTotal()

  // El usuario real viene de la sesión (GET /api/auth/me); el del
  // sidebar-data es solo el fallback mientras no hay sesión.
  const user = authUser
    ? {
        name: authUser.nombre || authUser.email,
        email: authUser.email,
        avatar: '',
      }
    : sidebarData.user

  const navGroups = useMemo<NavGroupProps[]>(() => {
    const badgeUnread = unread > 0 ? String(unread) : undefined

    return sidebarData.navGroups
      .map((group) => {
        if (group.title === GRUPO_MENSAJERIA) {
          return {
            ...group,
            items: group.items
              .filter((item) =>
                item.title === 'Conectar WhatsApp'
                  ? isEnabled(MODULE_KEYS.WHATSAPP)
                  : isEnabled(MODULE_KEYS.INBOX)
              )
              .map((item) =>
                item.title === 'Inbox' && badgeUnread
                  ? { ...item, badge: badgeUnread }
                  : item
              ),
          }
        }

        if (group.title === GRUPO_GESTION) {
          return {
            ...group,
            items: group.items.filter((item) => {
              if (item.title === 'Cocina') return isEnabled(MODULE_KEYS.KDS)
              if (item.title === 'Carta') return isEnabled(MODULE_KEYS.CARTA)
              return true
            }),
          }
        }

        return group
      })
      .filter((group) => group.items.length > 0)
  }, [isEnabled, unread])

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <BrandHeader />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
