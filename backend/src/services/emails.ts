import { and, eq } from 'drizzle-orm'
import sanitizeHtml from 'sanitize-html'

import { db } from '../db/client.js'
import { campaigns, emails, senders } from '../db/schema.js'
import { notFound } from '../lib/errors.js'
import { enqueueEmailJob } from '../queue/emailQueue.js'
import type { ScheduleCampaignInput } from '../schemas/emails.js'

export interface ScheduleCampaignArgs extends ScheduleCampaignInput {
  userId: string
}

function toPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()
}

/**
 * Creates a campaign and one email row per recipient, atomically.
 * scheduledAt is spaced by delaySeconds per recipient, starting at startAt.
 * position preserves the original recipient order for later overflow rescheduling.
 * idempotencyKey is deterministic per (idempotencyKey base, recipient) so a
 * retried request with the same key does not create duplicate email rows.
 */
export async function scheduleCampaign(args: ScheduleCampaignArgs) {
  const {
    userId,
    senderId,
    subject,
    bodyHtml,
    bodyText,
    recipients,
    startAt,
    delaySeconds,
    hourlyLimit,
    idempotencyKey,
  } = args

  const [sender] = await db
    .select({ id: senders.id })
    .from(senders)
    .where(and(eq(senders.id, senderId), eq(senders.userId, userId)))

  if (!sender) {
    throw notFound('Sender not found')
  }

  const cleanHtml = sanitizeHtml(bodyHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
  })
  const cleanText = bodyText?.trim() || toPlainText(bodyHtml)

  // De-duplicate recipients while preserving first-seen order.
  const uniqueRecipients = [...new Set(recipients.map((r) => r.toLowerCase()))]

  const baseKey = idempotencyKey ?? crypto.randomUUID()
  const start = new Date(startAt)

  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        userId,
        senderId,
        subject,
        bodyHtml: cleanHtml,
        bodyText: cleanText,
        startAt: start,
        delaySeconds,
        hourlyLimit,
      })
      .returning()

    if (!campaign) throw new Error('Failed to create campaign')

    const rows = uniqueRecipients.map((toEmail, index) => ({
      campaignId: campaign.id,
      userId,
      senderId,
      toEmail,
      subject,
      bodyHtml: cleanHtml,
      bodyText: cleanText,
      position: index,
      scheduledAt: new Date(start.getTime() + index * delaySeconds * 1000),
      idempotencyKey: `${baseKey}:${toEmail}`,
    }))

    const createdEmails = await tx.insert(emails).values(rows).returning()

    return { campaign, emails: createdEmails }
  })

  // Enqueue only after the transaction has committed, so a job is never
  // created for a row that doesn't actually exist in the database.
  await Promise.all(result.emails.map((e) => enqueueEmailJob(e.id, e.scheduledAt)))

  return result
}

export async function listScheduled(userId: string) {
  return db.query.emails.findMany({
    where: (e, { eq, and }) => and(eq(e.userId, userId), eq(e.status, 'scheduled')),
    orderBy: (e, { asc }) => [asc(e.scheduledAt), asc(e.position)],
  })
}

export async function listSent(userId: string) {
  return db.query.emails.findMany({
    where: (e, { eq, and, inArray }) =>
      and(eq(e.userId, userId), inArray(e.status, ['sent', 'failed'])),
    orderBy: (e, { desc }) => [desc(e.sentAt)],
  })
}






