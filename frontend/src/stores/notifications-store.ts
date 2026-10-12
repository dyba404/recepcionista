import { create } from 'zustand'
import type { NotificationItem } from '@/lib/types'

/**
 * Notificaciones de la campana (contrato horarios-pausa-notif-perfil,
 * sección C): zustand SOLO EN MEMORIA de sesión — nada de localStorage;
 * al recargar la lista arranca vacía y se llena con lo que llegue por el
 * WS compartido (use-notifications). El techo de 50 evita que una sesión
 * larga de un sábado ocupado crezca sin límite.
 */

const MAX_ITEMS = 50

interface NotificationsState {
  /** Más recientes primero. */
  items: NotificationItem[]
  /** items sin leer (los que entraron después del último "Marcar leídas"). */
  unreadCount: number
  push: (item: NotificationItem) => void
  markAllRead: () => void
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  items: [],
  unreadCount: 0,
  push: (item) =>
    set((state) => ({
      items: [item, ...state.items].slice(0, MAX_ITEMS),
      unreadCount: Math.min(state.unreadCount + 1, MAX_ITEMS),
    })),
  markAllRead: () => set({ unreadCount: 0 }),
}))
