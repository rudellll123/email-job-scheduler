import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { slackConnections } from '../db/schema.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { badRequest } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { redis } from '../lib/redis.js'
import { hourWindowKey } from './rateLimiter.js'

const STATE_TTL_SECONDS = 10 * 60
const NOTICE_TTL_SECONDS = 2 * 60 * 60
const BOT_SCOPES = ['chat:write', 'incoming-webhook']

const stateKey = (state: string) => `slack-oauth-state:${state}`

/** Redis key that limits rate-limit alerts to one per sender per hour window. */
export const rateLimitNoticeKey = (senderId: string, now: Date = new Date()) =>
  `slack-notified:${senderId}:${hourWindowKey(now)}`

/**
 * Starts the Slack OAuth flow for a logged-in user. Stores a random one-time
 * `state` in Redis bound to the user id (10 minute TTL) and returns the Slack
 * authorize URL to redirect the browser to.
 */
export async function createConnectUrl(userId: string): Promise<string> {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw badRequest('Slack is not configured on the server')
  }

  const state = randomBytes(24).toString('hex')
  await redis.set(stateKey(state), userId, 'EX', STATE_TTL_SECONDS)

  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID)
  url.searchParams.set('scope', BOT_SCOPES.join(','))
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI)
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Validates and burns the OAuth state in one atomic step (GETDEL), so a state
 * can never be used twice. It must belong to the user who is finishing the flow.
 */
async function consumeState(state: string, userId: string): Promise<void> {
  const owner = await redis.getdel(stateKey(state))
  if (!owner || owner !== userId) {
    throw badRequest('Invalid or expired Slack authorization. Please try connecting again.')
  }
}

const tokenResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  access_token: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string() }).optional(),
  incoming_webhook: z.object({ channel_id: z.string().optional() }).optional(),
})

interface SlackGrant {
  accessToken: string
  teamId: string
  teamName: string
  channelId: string
}

async function exchangeCode(code: string): Promise<SlackGrant> {
  let raw: unknown
  try {
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    raw = await res.json()
  } catch {
    throw badRequest('Could not reach Slack. Please try again.')
  }

  const parsed = tokenResponseSchema.safeParse(raw)
  if (!parsed.success) throw badRequest('Unexpected response from Slack')

  const data = parsed.data
  if (!data.ok || !data.access_token || !data.team) {
    throw badRequest(`Slack authorization failed: ${data.error ?? 'unknown error'}`)
  }

  const channelId = data.incoming_webhook?.channel_id
  if (!channelId) {
    throw badRequest('Slack did not return a channel. Reconnect and choose a channel.')
  }

  return {
    accessToken: data.access_token,
    teamId: data.team.id,
    teamName: data.team.name,
    channelId,
  }
}

/**
 * Finishes the OAuth flow: checks the state, exchanges the code for a token,
 * and stores the token ENCRYPTED. One row per user; reconnecting replaces it.
 */
export async function handleCallback(userId: string, code: string, state: string) {
  await consumeState(state, userId)
  const grant = await exchangeCode(code)

  const values = {
    teamId: grant.teamId,
    teamName: grant.teamName,
    channelId: grant.channelId,
    accessTokenEnc: encrypt(grant.accessToken),
  }

  await db
    .insert(slackConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: slackConnections.userId, set: values })

  return { teamName: grant.teamName }
}

/** Connection status for the UI. Never includes the token. */
export async function getStatus(userId: string): Promise<{ connected: boolean; teamName?: string }> {
  const [row] = await db
    .select({ teamName: slackConnections.teamName })
    .from(slackConnections)
    .where(eq(slackConnections.userId, userId))

  return row ? { connected: true, teamName: row.teamName } : { connected: false }
}

/** Removes the stored connection. Returns false if there was none. */
export async function disconnect(userId: string): Promise<boolean> {
  const removed = await db
    .delete(slackConnections)
    .where(eq(slackConnections.userId, userId))
    .returning({ id: slackConnections.id })

  return removed.length > 0
}

export type NotifyResult = 'sent' | 'not-connected' | 'duplicate' | 'failed'

export interface RateLimitNotice {
  userId: string
  senderId: string
  senderEmail: string
  hourlyLimit: number
  nextWindowStart: Date
}

const postResponseSchema = z.object({ ok: z.boolean(), error: z.string().optional() })

/**
 * Posts a live Slack message when a sender hits its hourly limit.
 *  - No Slack connection for the user: silent no-op ('not-connected').
 *  - At most one alert per sender per hour window ('duplicate' otherwise).
 *  - Never throws: a Slack problem must not break email sending. On failure the
 *    per-hour guard is released so a later deferral can retry.
 */
export async function notifyRateLimitHit(notice: RateLimitNotice): Promise<NotifyResult> {
  const noticeKey = rateLimitNoticeKey(notice.senderId)
  try {
    const [connection] = await db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, notice.userId))

    if (!connection) return 'not-connected'

    const first = await redis.set(noticeKey, '1', 'EX', NOTICE_TTL_SECONDS, 'NX')
    if (first !== 'OK') return 'duplicate'

    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${decrypt(connection.accessTokenEnc)}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: connection.channelId,
          text:
            `:warning: *Hourly send limit reached* for sender \`${notice.senderEmail}\` ` +
            `(limit: ${notice.hourlyLimit} emails/hour). Remaining emails were rescheduled to the next ` +
            `hour window, starting ${notice.nextWindowStart.toISOString()}. No emails were dropped.`,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = postResponseSchema.parse(await res.json())
      if (!data.ok) throw new Error(`Slack error: ${data.error ?? 'unknown'}`)
      return 'sent'
    } catch (err) {
      await redis.del(noticeKey)
      logger.warn(
        { senderId: notice.senderId, err: err instanceof Error ? err.message : String(err) },
        'slack rate-limit notification failed',
      )
      return 'failed'
    }
  } catch (err) {
    logger.warn(
      { senderId: notice.senderId, err: err instanceof Error ? err.message : String(err) },
      'slack rate-limit notification failed',
    )
    return 'failed'
  }
}
