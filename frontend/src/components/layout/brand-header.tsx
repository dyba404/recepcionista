import { Link } from '@tanstack/react-router'
import { BrandLogo } from '@/components/brand-logo'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

/**
 * Header del sidebar: logo (cuadradito gradiente tomate + llama) y
 * wordmark. Reemplaza al TeamSwitcher del template (un solo producto,
 * sin selector de equipos falso).
 */
export function BrandHeader() {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          asChild
          className='hover:bg-transparent active:bg-transparent'
        >
          <Link to='/' onClick={() => setOpenMobile(false)}>
            <BrandLogo />
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-semibold'>Recepcionista</span>
              <span className='truncate text-xs text-muted-foreground'>
                Pedidos por WhatsApp
              </span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
