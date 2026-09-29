import { Worker } from 'bullmq'

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
    async (job) => {
      await processEmailJob(job.data.emailId, job.attemptsMade, job.opts.attempts ?? 1)
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
