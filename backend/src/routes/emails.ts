import { Router } from 'express'

import { requireAuth } from '../middleware/requireAuth.js'
import { scheduleCampaignSchema } from '../schemas/emails.js'
import { listScheduled, listSent, scheduleCampaign } from '../services/emails.js'

export const emailsRouter = Router()

emailsRouter.use(requireAuth)

emailsRouter.post('/schedule', async (req, res, next) => {
  try {
    const input = scheduleCampaignSchema.parse(req.body)
    const result = await scheduleCampaign({ ...input, userId: req.user!.id })
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

emailsRouter.get('/scheduled', async (req, res, next) => {
  try {
    const items = await listScheduled(req.user!.id)
    res.json({ emails: items })
  } catch (err) {
    next(err)
  }
})

emailsRouter.get('/sent', async (req, res, next) => {
  try {
    const items = await listSent(req.user!.id)
    res.json({ emails: items })
  } catch (err) {
    next(err)
  }
})
