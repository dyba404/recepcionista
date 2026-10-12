import { createFileRoute, redirect } from '@tanstack/react-router'

// Canonicaliza /settings → /settings/profile (la pestaña por defecto).
export const Route = createFileRoute('/_authenticated/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile', replace: true })
  },
})
