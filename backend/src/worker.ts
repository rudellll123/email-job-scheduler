import { DelayedError, Worker } from 'bullmq'

import { createRedis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { env } from './config/env.js'
import { EMAIL_QUEUE_NAME, type EmailJobData } from './queue/emailQueue.js'
import { processEmailJob } from './services/sendEmail.js'
import { reconcileOnStartup } from './services/reconcile.js'

async function main() {
  await reconcileOnStartup()

  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job, token) => {
      const result = await processEmailJob(job.data.emailId, job.attemptsMade, job.opts.attempts ?? 1)

      if (result) {
        // Rate limiter postponed this send. Move THIS job to the new time
        // (same job id, so idempotency holds) and tell BullMQ it was delayed,
        // not failed or completed.
        await job.moveToDelayed(result.deferredUntil.getTime(), token)
        throw new DelayedError()
      }
    },
    {
      connection: createRedis(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  )

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'email job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'email job failed')
  })

  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started')
}

main().catch((err) => {
  logger.error({ err }, 'worker crashed on startup')
  process.exit(1)
})
