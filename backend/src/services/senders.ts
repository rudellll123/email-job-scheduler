import nodemailer from 'nodemailer'

import { db } from '../db/client.js'
import { senders } from '../db/schema.js'
import { encrypt } from '../lib/crypto.js'
import { conflict } from '../lib/errors.js'

export interface CreateSenderInput {
  userId: string
  label?: string
}

/**
 * Creates a brand-new Ethereal test SMTP account and stores it as a sender
 * for this user. Each call provisions a fresh inbox at ethereal.email.
 */
export async function createEtherealSender({ userId }: CreateSenderInput) {
  const account = await nodemailer.createTestAccount()

  try {
    const [row] = await db
      .insert(senders)
      .values({
        userId,
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPassEnc: encrypt(account.pass),
      })
      .returning()

    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict('A sender with this email already exists')
    }
    throw err
  }
}

export async function listSenders(userId: string) {
  return db.query.senders.findMany({
    where: (s, { eq }) => eq(s.userId, userId),
    columns: {
      id: true,
      email: true,
      smtpHost: true,
      smtpPort: true,
      createdAt: true,
      userId: false,
      smtpUser: false,
      smtpPassEnc: false,
    },
  })
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'
}
