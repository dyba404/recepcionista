import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function MaintenanceError() {
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'>503</h1>
        <span className='font-medium'>¡Sitio en mantenimiento!</span>
        <p className='text-center text-muted-foreground'>
          El sitio no está disponible en este momento. <br />
          Volvemos en breve.
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            Volver
          </Button>
        </div>
      </div>
    </div>
  )
}
