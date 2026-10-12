import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Cliente } from '@/features/cliente'

const searchSchema = z.object({
  tenant: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/cliente/')({
  validateSearch: searchSchema,
  component: Cliente,
})
