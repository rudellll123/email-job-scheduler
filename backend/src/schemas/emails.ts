import { z } from 'zod'

export const scheduleCampaignSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  recipients: z
    .array(z.string().trim().email())
    .min(1, 'At least one recipient is required')
    .max(5000, 'Too many recipients in a single batch'),
  startAt: z.string().datetime(),
  delaySeconds: z.number().int().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(10000),
  idempotencyKey: z.string().min(1).max(200).optional(),
})

export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>
