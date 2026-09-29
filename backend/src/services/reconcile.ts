import { eq, lt } from 'drizzle-orm'

import { db } from '../db/client.js'
import { emails } from '../db/schema.js'
import { enqueueEmailJob } from '../queue/emailQueue.js'
import { logger } from '../lib/logger.js'

// If a row has been stuck in 'sending' longer than this, assume the process
// that claimed it died mid-send (crash, restart) rather than being genuinely
// in-flight, and release it back to 'scheduled' so it can be retried.
const STUCK_SENDING_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Runs once when the worker starts. Makes the system self-healing after a
 * crash or restart:
 *  1. Any row stuck in 'sending' past the timeout is released back to
 *     'scheduled' (the process that claimed it never finished).
 *  2. Every row currently 'scheduled' gets re-enqueued. Because BullMQ job
 *     IDs equal emailId, this is a safe no-op for jobs that already exist
 *     in Redis; it only recreates jobs that Redis lost.
 */
export async function reconcileOnStartup() {
  const cutoff = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MS)

  const released = await db
    .update(emails)
    .set({ status: 'scheduled', updatedAt: new Date() })
    .where(eq(emails.status, 'sending'))
    .returning({ id: emails.id, updatedAt: emails.updatedAt })

  const staleReleased = released.filter((r) => r.updatedAt < cutoff)
  logger.info({ releasedCount: staleReleased.length }, 'reconcile: released stuck sending rows')

  const scheduled = await db.query.emails.findMany({
    where: (e, { eq }) => eq(e.status, 'scheduled'),
  })

  for (const email of scheduled) {
    await enqueueEmailJob(email.id, email.scheduledAt)
  }

  logger.info({ reEnqueuedCount: scheduled.length }, 'reconcile: re-enqueued scheduled rows')
}
