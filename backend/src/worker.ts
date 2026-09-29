import { DelayedError, Worker } from 'bullmq'

import { createRedis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { env } from './config/env.js'
import { EMAIL_QUEUE_NAME, type EmailJobData } from './queue/emailQueue.js'
import { processEmailJob } from './services/sendEmail.js'
import { reconcileOnStartup } from './services/reconcile.js'

// ---- Process-level diagnostics (registered first so startup failures are caught too) ----

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException, exiting')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandledRejection, exiting')
  process.exit(1)
})

// Only synchronous code runs in an 'exit' handler, so use console.error here.
process.on('exit', (code) => {
  console.error(`[worker] process exit, code=${code}, time=${new Date().toISOString()}`)
})

let workerRef: Worker<EmailJobData> | null = null
let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.warn({ signal }, 'signal received, shutting down worker')
  const force = setTimeout(() => {
    logger.error('graceful close timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  try {
    await workerRef?.close()
  } catch (err) {
    logger.error({ err }, 'error while closing worker')
  }
  clearTimeout(force)
  process.exit(0)
}

// SIGHUP fires when the console window is closed. SIGBREAK is Ctrl+Break on Windows.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(sig, () => {
    void shutdown(sig)
  })
}

// ---- Worker ----

async function main() {
  await reconcileOnStartup()

  const connection = createRedis()
  connection.on('error', (err) => {
    logger.error({ err: err.message }, 'redis connection error')
  })
  connection.on('close', () => logger.warn('redis connection closed'))
  connection.on('reconnecting', () => logger.warn('redis reconnecting'))

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
      connection,
      concurrency: env.WORKER_CONCURRENCY,
    },
  )
  workerRef = worker

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'email job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'email job failed')
  })

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'worker error event')
  })

  worker.on('closed', () => logger.warn('worker closed'))

  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started')
}

main().catch((err) => {
  logger.error({ err }, 'worker crashed on startup')
  process.exit(1)
})
