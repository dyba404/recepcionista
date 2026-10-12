import { useState } from 'react'
import { Hourglass, Link2, RefreshCw } from 'lucide-react'
import { apiErrorDetail } from '@/lib/api'
import { formatFechaHora } from '@/lib/datetime'
import type { Invitation } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/features/whatsapp/components/copy-button'
import { useInvitaciones, useRevocarInvitacion } from '@/hooks/use-invitaciones'
import { ETIQUETA_ROL } from '../etiqueta-rol'
import { RolChip } from './rol-chip'

/**
 * "Invitaciones pendientes" (contrato endurecer-local, sección C): los
 * enlaces creados por el dueño/admin que aún nadie aceptó — GET
 * /api/invitaciones?tenant= (manage_team). Cada fila puede copiar su enlace
 * y revocarse con confirmación (DELETE /api/invitaciones/{id}); las que
 * nadie revoca expiran solas a los 7 días.
 */
export function InvitacionesPendientes({ tenant }: { tenant: string }) {
  const invitacionesQuery = useInvitaciones(tenant)
  const revocarMut = useRevocarInvitacion(tenant)

  const [pendienteRevocar, setPendienteRevocar] = useState<Invitation | null>(
    null
  )
  const [revocarError, setRevocarError] = useState<string | null>(null)

  const invitaciones = invitacionesQuery.data ?? []

  function revocar() {
    if (!pendienteRevocar) return
    revocarMut.mutate(pendienteRevocar.id, {
      onSuccess: () => {
        setPendienteRevocar(null)
        setRevocarError(null)
      },
      onError: (err) => {
        setRevocarError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Link2 className='size-4 text-primary' />
            Invitaciones pendientes
          </CardTitle>
          <CardDescription>
            Enlaces que aún nadie acepta. Expiran solos a los 7 días; revocar
            cancela el enlace de inmediato.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {invitacionesQuery.isPending && (
            <div className='space-y-2'>
              <Skeleton className='h-12 w-full' />
              <Skeleton className='h-12 w-full' />
            </div>
          )}

          {invitacionesQuery.isError && (
            <Alert variant='destructive'>
              <AlertTitle>No se pudo cargar las invitaciones</AlertTitle>
              <AlertDescription className='flex flex-wrap items-center gap-3'>
                <span>
                  {apiErrorDetail(invitacionesQuery.error) ??
                    invitacionesQuery.error.message}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1.5'
                  onClick={() => void invitacionesQuery.refetch()}
                >
                  <RefreshCw className='size-3.5' /> Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!invitacionesQuery.isPending && !invitacionesQuery.isError && (
            <div className='overflow-hidden rounded-lg border'>
              <Table>
                <TableHeader className='bg-muted/50'>
                  <TableRow>
                    <TableHead>Correo</TableHead>
                    <TableHead className='w-40'>Rol</TableHead>
                    <TableHead className='w-40'>Expira</TableHead>
                    <TableHead className='w-32'>Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitaciones.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className='h-20 text-center text-muted-foreground'
                      >
                        Sin invitaciones pendientes. Crea una con "Por enlace"
                        arriba.
                      </TableCell>
                    </TableRow>
                  )}
                  {invitaciones.map((inv) => {
                    const url = `${window.location.origin}${inv.url}`
                    return (
                      <TableRow key={String(inv.id)}>
                        <TableCell>
                          <div className='flex max-w-md items-center gap-1'>
                            <span className='truncate text-sm'>
                              {inv.email}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CopyButton
                                  value={url}
                                  label='Enlace de invitación'
                                />
                              </TooltipTrigger>
                              <TooltipContent>Copiar enlace</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          <RolChip rol={inv.rol} />
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-muted-foreground'>
                          <span className='inline-flex items-center gap-1.5'>
                            <Hourglass className='size-3.5 shrink-0' />
                            {formatFechaHora(inv.expires_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='outline'
                            size='sm'
                            className='gap-1.5 text-destructive hover:text-destructive'
                            disabled={
                              revocarMut.isPending &&
                              pendienteRevocar?.id === inv.id
                            }
                            onClick={() => {
                              setPendienteRevocar(inv)
                              setRevocarError(null)
                            }}
                          >
                            Revocar
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendienteRevocar !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendienteRevocar(null)
            setRevocarError(null)
          }
        }}
        title='Revocar invitación'
        desc={
          pendienteRevocar
            ? `¿Revocar la invitación de ${pendienteRevocar.email} (${ETIQUETA_ROL[pendienteRevocar.rol] ?? pendienteRevocar.rol})? El enlace deja de funcionar de inmediato y tendrás que crear una nueva.`
            : ''
        }
        confirmText='Revocar'
        destructive
        isLoading={revocarMut.isPending}
        handleConfirm={revocar}
        className='sm:max-w-sm'
      >
        {revocarError && (
          <p role='alert' className='text-sm font-medium text-destructive'>
            {revocarError}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
