/**
 * Coding Plan quota resets: the zcode.z.ai endpoints behind the official
 * client's reset card.
 *
 *   GET  /api/v1/coding-plan/reset/status  → how many five-hour / week
 *        resets are available and when the earliest expires
 *   POST /api/v1/coding-plan/reset/use     → consume one
 *        ({ idempotency_key, reset_type: "FIVE_HOUR" | "WEEK" })
 *
 * Both take the ZCode platform JWT as the bearer and the BigModel login
 * token under `X-Bigmodel-Authorization` — the pair the sign-in grant
 * already stores. The plugin offers the five-hour reset, which is what the
 * official reset card's button does.
 *
 * @module dsh-zcode/reset
 */

import { randomUUID } from 'node:crypto'
import { ZCODE_OAUTH_ORIGIN } from './zcode-oauth.ts'
import type { ZcodeGrant } from './types.ts'
import type { ZcodeResetDoc, ZcodeResetUseDoc } from './webui-protocol.ts'

const REQUEST_TIMEOUT_MS = 15_000

/** Failure text for the browser, mirroring the other webui redaction rules. */
function resetErrorText(error: unknown): string {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error)
  return message
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/([?&](?:token|access_token|code)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 300)
}

/** zcode.z.ai answers the code-0 envelope (200 tolerated defensively). */
function readData(envelope: { code?: unknown, msg?: unknown, data?: unknown }): Record<string, unknown> {
  if (envelope.code !== undefined && envelope.code !== 0 && envelope.code !== 200) {
    const msg = typeof envelope.msg === 'string' && envelope.msg.trim() !== '' ? `: ${envelope.msg}` : ''
    throw new Error(`reset endpoint failed (code ${String(envelope.code)})${msg}`)
  }
  if (typeof envelope.data === 'object' && envelope.data !== null) return envelope.data as Record<string, unknown>
  throw new Error('reset endpoint response is missing data')
}

/** The auth pair the reset endpoints require, from one stored grant. */
function resetHeaders(grant: ZcodeGrant, appVersion: string): Record<string, string> {
  if (grant.zcodeJwt === undefined || grant.zcodeJwt.trim() === '') {
    throw new Error('the stored sign-in carries no ZCode platform JWT; sign in again to enable resets')
  }
  const bearer = /^Bearer\s/i.test(grant.zcodeJwt) ? grant.zcodeJwt : `Bearer ${grant.zcodeJwt}`
  return {
    Authorization: bearer,
    'X-Bigmodel-Authorization': grant.accessToken,
    // Personal-scope is required (the official client's yv(headers, true));
    // team contexts are not offered by this plugin.
    'Bigmodel-Target-Type': 'PERSONAL',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `ZCode/${appVersion}`,
    'X-ZCode-App-Version': appVersion,
  }
}

export class CodingPlanResetClient {
  constructor(private readonly deps: {
    loadGrant: () => Promise<ZcodeGrant | undefined>
    /** Client version reported in the source headers. */
    appVersion: string
    origin?: string
  }) {}

  /** Read the reset availability snapshot. Never throws. */
  async status(): Promise<ZcodeResetDoc> {
    const grant = await this.deps.loadGrant()
    if (grant === undefined) return { status: 'signed-out', fetchedAt: Date.now() }
    const origin = this.deps.origin ?? ZCODE_OAUTH_ORIGIN
    try {
      const response = await fetch(`${origin}/api/v1/coding-plan/reset/status`, {
        method: 'GET',
        headers: resetHeaders(grant, this.deps.appVersion),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const data = readData(await response.json().catch(() => null) as { code?: unknown, msg?: unknown, data?: unknown })
      const fiveHour = Array.isArray(data.available_five_hour_resets) ? data.available_five_hour_resets : []
      const week = Array.isArray(data.available_week_resets) ? data.available_week_resets : []
      const expires = (entries: unknown[]): number | undefined => {
        const times = entries
          .map(entry => typeof entry === 'object' && entry !== null ? (entry as { expire_at?: unknown }).expire_at : undefined)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        return times.length > 0 ? Math.min(...times) : undefined
      }
      return {
        status: 'ok',
        fetchedAt: Date.now(),
        fiveHourAvailable: fiveHour.length,
        ...(fiveHour.length > 0 && expires(fiveHour) !== undefined ? { fiveHourEarliestExpireAt: expires(fiveHour) } : {}),
        weekAvailable: week.length,
        ...(week.length > 0 && expires(week) !== undefined ? { weekEarliestExpireAt: expires(week) } : {}),
      }
    } catch (error) {
      return { status: 'error', fetchedAt: Date.now(), error: resetErrorText(error) }
    }
  }

  /**
   * Consume one five-hour reset. Never throws; a success also tells the
   * caller to drop the quota cache so the next read shows the fresh window.
   * @returns the use result document and whether the quota cache should reset.
   */
  async useFiveHour(): Promise<{ doc: ZcodeResetUseDoc, quotaStale: boolean }> {
    const grant = await this.deps.loadGrant()
    if (grant === undefined) {
      return { doc: { status: 'signed-out' }, quotaStale: false }
    }
    const origin = this.deps.origin ?? ZCODE_OAUTH_ORIGIN
    try {
      const response = await fetch(`${origin}/api/v1/coding-plan/reset/use`, {
        method: 'POST',
        headers: resetHeaders(grant, this.deps.appVersion),
        body: JSON.stringify({ idempotency_key: randomUUID(), reset_type: 'FIVE_HOUR' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const data = readData(await response.json().catch(() => null) as { code?: unknown, msg?: unknown, data?: unknown })
      const used = (data as { used?: unknown }).used === true
      if (!used) throw new Error('the reset endpoint accepted the request but reported no reset used')
      return { doc: { status: 'ok', used: true }, quotaStale: true }
    } catch (error) {
      return { doc: { status: 'error', error: resetErrorText(error) }, quotaStale: false }
    }
  }
}
