import { Queue } from 'bullmq'

import { createRedis } from '../lib/redis.js'

export const EMAIL_QUEUE_NAME = 'email-send'

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
})

export interface EmailJobData {
  emailId: string
}

/**
 * Enqueues (or re-enqueues) a delayed send job for one email.
 * jobId = emailId, so calling this twice for the same email is a safe no-op:
 * BullMQ will not create a duplicate job.
 */
export async function enqueueEmailJob(emailId: string, scheduledAt: Date) {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now())
  await emailQueue.add(
    'send-email',
    { emailId } satisfies EmailJobData,
    { jobId: emailId, delay },
  )
}
