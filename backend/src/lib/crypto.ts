import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { env } from '../config/env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function getKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, hex encoded (64 characters)')
  }
  return key
}

/** Encrypts text. Output format: iv.tag.ciphertext (all base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, data].map((b) => b.toString('base64')).join('.')
}

/** Reverses encrypt(). Throws if the value was tampered with. */
export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !data) throw new Error('Malformed encrypted payload')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
