type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Contenedor centrado para las pantallas de auth. La marca (logo + nombre)
 * vive dentro de la card de cada pantalla, no duplicada arriba.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        {children}
      </div>
    </div>
  )
}
