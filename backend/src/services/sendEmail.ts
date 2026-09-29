import { and, eq } from 'drizzle-orm'

import { db } from '../db/client.js'
import { emails, senders } from '../db/schema.js'
import { sendViaSender } from './mailer.js'

export type ClaimResult =
  | { claimed: false }
  | { claimed: true; alreadyFinal: false }

/**
 * Attempts to send one email end to end:
 *  1. Atomically flips status scheduled -> sending. If the row is not in
 *     'scheduled' anymore (already sent, already sending, cancelled), this
 *     claims nothing and the function returns without side effects.
 *  2. Loads the email + its sender, sends via Ethereal.
 *  3. On success: sending -> sent, records messageId/previewUrl.
 *  4. On failure: increments attempts; if more BullMQ retries remain, sets
 *     status back to 'scheduled' and rethrows so BullMQ retries with backoff;
 *     if this was the last allowed attempt, sets status to 'failed' instead
 *     and does not rethrow, so the job completes rather than retrying forever.
 */
export async function processEmailJob(emailId: string, attemptsMade: number, maxAttempts: number) {
  const claimed = await db
    .update(emails)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(emails.id, emailId), eq(emails.status, 'scheduled')))
    .returning({ id: emails.id })

  if (claimed.length === 0) {
    // Someone else already claimed it, or it is no longer in a sendable state.
    return
  }

  const row = await db.query.emails.findFirst({
    where: (e, { eq }) => eq(e.id, emailId),
    with: { sender: true },
  })

  if (!row) return

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
  }
}
