import { KeyRound, Shield, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** Badge de rol (contrato roles-equipo): Dueño emerald / Administrador azul / Staff ámbar. */
export function RolChip({ rol }: { rol: string }) {
  if (rol === 'owner') {
    return (
      <Badge className='gap-1 bg-emerald-600 text-white'>
        <ShieldCheck className='size-3' /> Dueño
      </Badge>
    )
  }
  if (rol === 'admin') {
    return (
      <Badge className='gap-1 bg-blue-600 text-white'>
        <Shield className='size-3' /> Administrador
      </Badge>
    )
  }
  return (
    <Badge
      variant='outline'
      className='gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400'
    >
      <KeyRound className='size-3' /> Staff
    </Badge>
  )
}
