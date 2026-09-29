import { Router } from 'express'

import { requireAuth } from '../middleware/requireAuth.js'
import { createEtherealSender, listSenders } from '../services/senders.js'

export const sendersRouter = Router()

sendersRouter.use(requireAuth)

sendersRouter.post('/', async (req, res, next) => {
  try {
    const sender = await createEtherealSender({ userId: req.user!.id })
    res.status(201).json({ sender })
  } catch (err) {
    next(err)
  }
})

sendersRouter.get('/', async (req, res, next) => {
  try {
    const items = await listSenders(req.user!.id)
    res.json({ senders: items })
  } catch (err) {
    next(err)
  }
})
