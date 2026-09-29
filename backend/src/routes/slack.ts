import { Router } from 'express'
import { z } from 'zod'

import { env } from '../config/env.js'
import { HttpError } from '../lib/errors.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { createConnectUrl, disconnect, getStatus, handleCallback } from '../services/slack.js'

export const slackRouter = Router()

/** Where to send the browser after the OAuth round trip, with a result flag for the UI. */
function backToApp(params: Record<string, string>): string {
  const url = new URL(env.FRONTEND_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
})

// Connection status for the UI (never includes the token).
slackRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await getStatus(req.user!.id))
  } catch (err) {
    next(err)
  }
})

// Step 1 of OAuth: the browser navigates here; we redirect it to Slack.
slackRouter.get('/connect', requireAuth, async (req, res, next) => {
  try {
    res.redirect(await createConnectUrl(req.user!.id))
  } catch (err) {
    next(err)
  }
})

// Step 2 of OAuth: Slack sends the browser back here with ?code&state.
slackRouter.get('/callback', async (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.redirect(backToApp({ slack: 'login_required' }))
  }

  const query = callbackQuery.safeParse(req.query)
  if (!query.success || query.data.error || !query.data.code || !query.data.state) {
    return res.redirect(backToApp({ slack: 'denied' }))
  }

  try {
    await handleCallback(req.user.id, query.data.code, query.data.state)
    return res.redirect(backToApp({ slack: 'connected' }))
  } catch (err) {
    if (err instanceof HttpError) {
      req.log.warn({ err: err.message }, 'slack callback rejected')
      return res.redirect(backToApp({ slack: 'error', message: err.message }))
    }
    return next(err)
  }
})

slackRouter.post('/disconnect', requireAuth, async (req, res, next) => {
  try {
    res.json({ disconnected: await disconnect(req.user!.id) })
  } catch (err) {
    next(err)
  }
})
