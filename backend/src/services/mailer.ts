import nodemailer from 'nodemailer'

import { decrypt } from '../lib/crypto.js'
import type { Sender } from '../db/schema.js'

export interface SendResult {
  messageId: string
  previewUrl: string | false
}

export async function sendViaSender(
  sender: Pick<Sender, 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPassEnc'>,
  message: { to: string; subject: string; html: string; text: string },
): Promise<SendResult> {
  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: false,
    auth: {
      user: sender.smtpUser,
      pass: decrypt(sender.smtpPassEnc),
    },
    tls: {
      rejectUnauthorized: false,
    },
  })

  const info = await transport.sendMail({
    from: sender.smtpUser,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  }
}


