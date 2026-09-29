import { and, eq, lt } from 'drizzle-orm'

import { db } from '../db/client.js'
import { emails } from '../db/schema.js'
import { enqueueEmailJob } from '../queue/emailQueue.js'
import { logger } from '../lib/logger.js'

// If a row has been stuck in 'sending' longer than this, assume the process
// that claimed it died mid-send (crash, restart) rather than being genuinely
// in-flight, and release it back to 'scheduled' so it can be retried.
// Rows younger than this are left alone: another worker may be sending them now.
const STUCK_SENDING_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Runs once when the worker starts. Makes the system self-healing after a
 * crash or restart:
 *  1. Rows stuck in 'sending' for longer than the timeout are released back
 *     to 'scheduled' (the process that claimed them never finished).
 *     Fresh 'sending' rows are NOT touched, so a second worker starting up
 *     cannot free an email another worker is sending right now.
 *  2. Every row currently 'scheduled' gets re-enqueued. Because BullMQ job
 *     IDs equal emailId, this is a safe no-op for jobs that already exist
 *     in Redis; it only recreates jobs that Redis lost.
 */
export async function reconcileOnStartup() {
  const cutoff = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MS)

  const released = await db
    .update(emails)
    .set({ status: 'scheduled', updatedAt: new Date() })
    .where(and(eq(emails.status, 'sending'), lt(emails.updatedAt, cutoff)))
    .returning({ id: emails.id })

  logger.info({ releasedCount: released.length }, 'reconcile: released stuck sending rows')

  const scheduled = await db.query.emails.findMany({
    where: (e, { eq }) => eq(e.status, 'scheduled'),
  })

  for (const email of scheduled) {
    await enqueueEmailJob(email.id, email.scheduledAt)
  }

  logger.info({ reEnqueuedCount: scheduled.length }, 'reconcile: re-enqueued scheduled rows')
}
