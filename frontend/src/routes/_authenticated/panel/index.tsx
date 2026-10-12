import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Panel } from '@/features/panel'

const searchSchema = z.object({
  tenant: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/panel/')({
  validateSearch: searchSchema,
  component: Panel,
})
