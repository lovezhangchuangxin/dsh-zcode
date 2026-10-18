/**
 * Client-side quota helpers: the fetch (with the shared wire guard) and the
 * presentation formatters shared by the Settings quota card and the
 * bottom-bar badge.
 *
 * @module dsh-zcode/client/quota
 */

import {
  isZcodeQuotaDoc, ZCODE_UI_QUOTA_PATH, type ZcodeQuotaDoc, type ZcodeQuotaLimit,
} from '../webui-protocol.ts'

/** Poll cadence for a visible quota surface; the host caches for the same span. */
export const QUOTA_POLL_MS = 60_000

/** Read the quota document; undefined when the route answered something unreadable. */
export async function fetchQuota(force: boolean): Promise<ZcodeQuotaDoc | undefined> {
  try {
    const res = await fetch(`${ZCODE_UI_QUOTA_PATH}${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
    const parsed: unknown = await res.json().catch(() => null)
    if (!res.ok || !isZcodeQuotaDoc(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** The 5-hour window entry, when the snapshot carries one. */
export function fiveHourLimit(doc: ZcodeQuotaDoc): ZcodeQuotaLimit | undefined {
  return doc.limits?.find(limit => limit.type === 'TIME_LIMIT')
}

/** The token-budget entry, when the snapshot carries one. */
export function tokensLimit(doc: ZcodeQuotaDoc): ZcodeQuotaLimit | undefined {
  return doc.limits?.find(limit => limit.type === 'TOKENS_LIMIT')
}

/** Percent already used, clamped to 0–100, from percentage or the usage/total ratio. */
export function usedPercent(limit: ZcodeQuotaLimit): number | undefined {
  if (typeof limit.percentage === 'number') return Math.min(100, Math.max(0, limit.percentage))
  const total = (limit.usage ?? 0) + (limit.remaining ?? 0)
  if (total > 0 && limit.currentValue !== undefined) {
    return Math.min(100, Math.max(0, Math.round(limit.currentValue / total * 100)))
  }
  return undefined
}

/** Compact remaining-time text: "42m", "2h 14m", "3d 5h". */
export function countdownText(resetAt: number, now = Date.now()): string {
  const ms = resetAt - now
  if (ms <= 0) return '0m'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Wall-clock text for a reset timestamp, with the date only when it is not today. */
export function resetClockText(resetAt: number): string {
  const date = new Date(resetAt)
  const sameDay = new Date().toDateString() === date.toDateString()
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return sameDay ? hm : `${date.getMonth() + 1}/${date.getDate()} ${hm}`
}
