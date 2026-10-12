import { Check, Laptop, Monitor, Moon, Sun } from 'lucide-react'
import { fonts } from '@/config/fonts'
import { cn } from '@/lib/utils'
import { useFont, type Font } from '@/context/font-provider'
import { useTheme, type Theme } from '@/context/theme-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Apariencia con cambios aplicados al instante (tema claro/oscuro/sistema
 * y fuente). Todo real: el theme-provider persiste en localStorage/cookie
 * y el font-provider en cookie. Sin formulario falso de "datos enviados".
 */

const THEME_OPTIONS: {
  value: Theme
  label: string
  icon: React.ReactNode
}[] = [
  { value: 'light', label: 'Claro', icon: <Sun className='size-4' /> },
  { value: 'dark', label: 'Oscuro', icon: <Moon className='size-4' /> },
  { value: 'system', label: 'Sistema', icon: <Laptop className='size-4' /> },
]

export function AppearanceForm() {
  const { theme, setTheme } = useTheme()
  const { font, setFont } = useFont()

  return (
    <div className='space-y-8'>
      <div className='space-y-2'>
        <Label>Tema</Label>
        <p className='text-sm text-muted-foreground'>
          Se aplica al instante en todo el panel.
        </p>
        <div
          className='grid max-w-md grid-cols-3 gap-3 pt-2'
          role='radiogroup'
          aria-label='Tema'
        >
          {THEME_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type='button'
              variant='outline'
              aria-pressed={theme === opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                'h-auto flex-col gap-2 px-2 py-4',
                theme === opt.value && 'border-primary ring-1 ring-primary'
              )}
            >
              {opt.icon}
              <span className='text-sm font-normal'>{opt.label}</span>
              {theme === opt.value && (
                <Check className='size-3.5 text-primary' />
              )}
            </Button>
          ))}
        </div>
      </div>

      <div className='space-y-2'>
        <Label>Fuente</Label>
        <p className='text-sm text-muted-foreground'>
          Cambia la tipografía de la interfaz.
        </p>
        <div className='relative w-max pt-2'>
          <Select value={font} onValueChange={(v) => setFont(v as Font)}>
            <SelectTrigger
              className={cn(buttonVariants({ variant: 'outline' }), 'w-50')}
            >
              <Monitor className='me-2 size-4 text-muted-foreground' />
              <SelectValue placeholder='Fuente' />
            </SelectTrigger>
            <SelectContent>
              {fonts.map((f) => (
                <SelectItem key={f} value={f}>
                  {f === 'system' ? 'Sistema' : f === 'manrope' ? 'Manrope' : 'Inter'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
