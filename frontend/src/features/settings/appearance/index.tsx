import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'

export function SettingsAppearance() {
  return (
    <ContentSection
      title='Apariencia'
      desc='Personaliza el tema (claro, oscuro o según tu sistema) y la fuente del panel.'
    >
      <AppearanceForm />
    </ContentSection>
  )
}
