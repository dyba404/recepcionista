import { useState } from 'react'
import { AlertTriangle, Lock, QrCode, RefreshCw, Upload } from 'lucide-react'
import { apiErrorDetail } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useUploadQrYape } from '@/hooks/use-tenant-qr'

const MAX_BYTES = 2 * 1024 * 1024 // contrato saas-cola-2: máx 2MB
const TIPOS_PERMITIDOS = ['image/png', 'image/jpeg']

/**
 * "QR de Yape real" (contrato saas-cola-2): sube la captura del QR de Yape
 * del local (multipart png/jpg) y la previsualiza desde
 * GET /api/tenants/{id}/qr. Solo owner. Nota honesta: la verificación de
 * pagos sigue siendo por monto exacto — el QR solo orienta al cliente.
 */
export function QrYapeSection({
  tenant,
  isOwner,
  tieneQr,
}: {
  tenant: string
  isOwner: boolean
  /** /api/payments/config trae yape_qr_imagen (backend viejo: undefined). */
  tieneQr: boolean
}) {
  const upload = useUploadQrYape(tenant)

  const [qrTs, setQrTs] = useState(() => Date.now()) // cache-buster
  const [imgError, setImgError] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    setUploadError(null)
    setImgError(false)
    if (!file) return
    if (!TIPOS_PERMITIDOS.includes(file.type)) {
      setUploadError('Sube una imagen PNG o JPG del QR.')
      return
    }
    if (file.size > MAX_BYTES) {
      setUploadError(
        `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB — el máximo es 2 MB.`
      )
      return
    }
    upload.mutate(file, {
      onSuccess: () => setQrTs(Date.now()),
      onError: (err) => {
        setUploadError(apiErrorDetail(err) ?? err.message)
      },
    })
  }

  const mostrarPreview = tieneQr || upload.isSuccess

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <QrCode className='size-4 text-primary' />
          QR de Yape real
        </CardTitle>
        <CardDescription>
          Sube la captura del QR de tu Yape (PNG o JPG, máx 2 MB): el chat de
          cliente la mostrará en vez del QR generado.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {!isOwner && (
          <Alert>
            <Lock className='size-4' />
            <AlertTitle>Solo el dueño puede hacer esto</AlertTitle>
            <AlertDescription>
              Subir el QR de Yape requiere rol owner. Pídele al dueño del
              local que complete este paso.
            </AlertDescription>
          </Alert>
        )}

        <div className='flex flex-col gap-4 sm:flex-row sm:items-center'>
          {mostrarPreview ? (
            imgError ? (
              <p className='max-w-40 text-xs text-muted-foreground'>
                No se pudo cargar la imagen del QR. Reintenta subiéndola de
                nuevo.
              </p>
            ) : (
              <div className='w-fit shrink-0 rounded-lg border bg-white p-2'>
                <img
                  src={`/api/tenants/${encodeURIComponent(tenant)}/qr?t=${qrTs}`}
                  alt='QR de Yape del local'
                  className='size-[124px] object-contain'
                  onError={() => setImgError(true)}
                />
              </div>
            )
          ) : (
            <div className='flex size-[140px] shrink-0 items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground'>
              Aún no subes el QR de tu Yape
            </div>
          )}

          <div className='min-w-0 space-y-2'>
            <div className='flex items-center gap-2'>
              <Input
                id='yape-qr-file'
                type='file'
                accept='image/png,image/jpeg'
                className='max-w-64'
                aria-label='Subir imagen del QR de Yape'
                disabled={!isOwner || upload.isPending}
                onChange={onFile}
              />
              {upload.isPending && (
                <RefreshCw className='size-4 shrink-0 animate-spin text-muted-foreground' />
              )}
            </div>
            <p className='text-xs text-muted-foreground'>
              <Upload className='me-1 inline size-3.5' />
              {upload.isPending
                ? 'Subiendo imagen…'
                : 'Elige el archivo y se sube al instante.'}
            </p>
            <p className='text-xs text-muted-foreground'>
              La verificación sigue siendo monto exacto — el QR solo orienta
              al cliente.
            </p>
          </div>
        </div>

        {upload.isError && uploadError && (
          <Alert variant='destructive'>
            <AlertTriangle className='size-4' />
            <AlertTitle>No se pudo subir el QR</AlertTitle>
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
