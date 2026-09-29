import { and, eq } from 'drizzle-orm'

import { db } from '../db/client.js'
import { campaigns, emails } from '../db/schema.js'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { sendViaSender } from './mailer.js'
import { effectiveHourlyLimit, releaseSendSlot, reserveSendSlot } from './rateLimiter.js'

/**
 * Returned when the send was postponed by the rate limiter. The caller (the
 * BullMQ worker) must delay the job itself until this time.
 */
export type ProcessResult = { deferredUntil: Date } | null

/**
 * Attempts to send one email end to end:
 *  1. Atomically flips status scheduled -> sending. If the row is not in
 *     'scheduled' anymore (already sent, already sending, cancelled), this
 *     claims nothing and the function returns without side effects.
 *  2. Reserves a send slot for the sender (hourly cap + minimum delay, atomic
 *     in Redis). If denied, the row goes back to 'scheduled' with a new
 *     scheduledAt and { deferredUntil } is returned. Nothing is dropped.
 *  3. Loads the email + its sender, sends via Ethereal. The sender's slot stays
 *     locked during the send and the minimum delay restarts when it finishes.
 *  4. On success: sending -> sent, records messageId/previewUrl.
 *  5. On failure: increments attempts; if more BullMQ retries remain, sets
 *     status back to 'scheduled' and rethrows so BullMQ retries with backoff;
 *     if this was the last allowed attempt, sets status to 'failed' instead
 *     and does not rethrow, so the job completes rather than retrying forever.
 */
export async function processEmailJob(
  emailId: string,
  attemptsMade: number,
  maxAttempts: number,
): Promise<ProcessResult> {
  const claimed = await db
    .update(emails)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(emails.id, emailId), eq(emails.status, 'scheduled')))
    .returning({ id: emails.id })

  if (claimed.length === 0) {
    // Someone else already claimed it, or it is no longer in a sendable state.
    return null
  }

  const row = await db.query.emails.findFirst({
    where: (e, { eq }) => eq(e.id, emailId),
    with: { sender: true },
  })

  if (!row) return null

  const [campaign] = await db
    .select({ hourlyLimit: campaigns.hourlyLimit, delaySeconds: campaigns.delaySeconds })
    .from(campaigns)
    .where(eq(campaigns.id, row.campaignId))

  const hourlyLimit = effectiveHourlyLimit(campaign?.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER)

  const slot = await reserveSendSlot(row.senderId, hourlyLimit)

  if (!slot.ok) {
    let deferredUntil: Date

    if (slot.reason === 'hourly-limit') {
      // Next hour window, spaced by position so original recipient order holds.
      const spacingMs = Math.max(campaign?.delaySeconds ?? 0, env.MIN_DELAY_SECONDS) * 1000
      deferredUntil = new Date(slot.nextWindowStart.getTime() + row.position * spacingMs)
    } else {
      deferredUntil = new Date(Date.now() + slot.retryAfterMs)
    }

    await db
      .update(emails)
      .set({ status: 'scheduled', scheduledAt: deferredUntil, updatedAt: new Date() })
      .where(and(eq(emails.id, emailId), eq(emails.status, 'sending')))

    logger.info(
      { emailId, senderId: row.senderId, reason: slot.reason, deferredUntil },
      'send deferred by rate limiter',
    )

    return { deferredUntil }
  }

  try {
    const result = await sendViaSender(row.sender, {
      to: row.toEmail,
      subject: row.subject,
      html: row.bodyHtml,
      text: row.bodyText,
    })

    await db
      .update(emails)
      .set({
        status: 'sent',
        sentAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl || null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, emailId))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isFinalAttempt = attemptsMade + 1 >= maxAttempts

    await db
      .update(emails)
      .set({
        status: isFinalAttempt ? 'failed' : 'scheduled',
        attempts: attemptsMade + 1,
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, emailId))

    if (!isFinalAttempt) {
      throw err // lets BullMQ retry with its configured backoff
    }
  } finally {
    // Runs on success, failure and rethrow: restart the full minimum delay
    // from the moment this send ended.
    await releaseSendSlot(row.senderId)
  }

  return null
}
