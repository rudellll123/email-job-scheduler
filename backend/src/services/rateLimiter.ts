import { redis } from '../lib/redis.js'
import { env } from '../config/env.js'

const HOUR_MS = 60 * 60 * 1000
const COUNTER_TTL_SECONDS = 2 * 60 * 60 // safety margin beyond the 1h window
const SEND_LOCK_MS = 60 * 1000 // max time a send may hold the sender's lock

export type SlotResult =
  | { ok: true }
  | { ok: false; reason: 'min-delay'; retryAfterMs: number }
  | { ok: false; reason: 'hourly-limit'; retryAfterMs: number; nextWindowStart: Date }

/**
 * Atomic check-and-reserve, executed inside Redis as one Lua script so that
 * any number of workers/processes can call it concurrently without races.
 *
 *  KEYS[1] = hourly counter for (sender, hour window)
 *  KEYS[2] = per-sender send lock / cooldown marker
 *  ARGV[1] = min delay in ms (0 disables), ARGV[2] = hourly limit,
 *  ARGV[3] = counter TTL secs, ARGV[4] = send lock TTL in ms
 *
 * 1. Hourly cap is checked first. If reached, nothing is modified.
 * 2. Then the marker. If it is still alive (another send in flight, or the
 *    cooldown after the previous send has not elapsed), nothing is modified.
 * 3. Only if both pass: increment the counter and take the send lock.
 *    The lock is shortened to the real min delay by releaseSendSlot() once the
 *    send finishes, so the delay is measured from send COMPLETION.
 */
const RESERVE_SCRIPT = `
local minDelayMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local lockMs = tonumber(ARGV[4])

local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= limit then
  return {'hourly', 0}
end

if minDelayMs > 0 then
  local pttl = redis.call('PTTL', KEYS[2])
  if pttl > 0 then
    return {'delay', pttl}
  end
end

local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
if minDelayMs > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', lockMs)
end
return {'ok', 0}
`

export function hourWindowKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13) // e.g. 2026-09-29T14 (UTC)
}

export function nextHourStart(date: Date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS)
}

/** Campaign limit, capped by the global env ceiling. */
export function effectiveHourlyLimit(campaignLimit: number): number {
  return Math.min(campaignLimit, env.MAX_EMAILS_PER_HOUR_PER_SENDER)
}

const delayKey = (senderId: string) => `last-send:${senderId}`

export async function reserveSendSlot(
  senderId: string,
  hourlyLimit: number,
  now: Date = new Date(),
): Promise<SlotResult> {
  const minDelayMs = Math.round(env.MIN_DELAY_SECONDS * 1000)
  const countKey = `hourly-count:${senderId}:${hourWindowKey(now)}`

  const [status, value] = (await redis.eval(
    RESERVE_SCRIPT,
    2,
    countKey,
    delayKey(senderId),
    minDelayMs,
    hourlyLimit,
    COUNTER_TTL_SECONDS,
    SEND_LOCK_MS,
  )) as [string, number]

  if (status === 'ok') return { ok: true }

  if (status === 'delay') {
    // While a send is in flight the lock has a long TTL, but the send will
    // usually finish much sooner. Re-check after at most one min-delay.
    const retryAfterMs = Math.max(1, Math.min(Number(value), minDelayMs))
    return { ok: false, reason: 'min-delay', retryAfterMs }
  }

  const nextWindowStart = nextHourStart(now)
  return {
    ok: false,
    reason: 'hourly-limit',
    retryAfterMs: nextWindowStart.getTime() - now.getTime(),
    nextWindowStart,
  }
}

/**
 * Call after a granted send finishes (success or failure). Replaces the long
 * send lock with the real cooldown, so the next send for this sender cannot
 * start until MIN_DELAY_SECONDS after this one ENDED.
 */
export async function releaseSendSlot(senderId: string): Promise<void> {
  const minDelayMs = Math.round(env.MIN_DELAY_SECONDS * 1000)
  if (minDelayMs > 0) {
    await redis.set(delayKey(senderId), '1', 'PX', minDelayMs)
  }
}
