/**
 * BigModel Coding Plan quota snapshot: `GET /api/monitor/usage/quota/limit`
 * with the raw login token — the same call the official ZCode client's
 * usage-stats module makes. The answer's `limits` carry the 5-hour window
 * (`TIME_LIMIT`: usage/currentValue/remaining/percentage/nextResetTime) and
 * the token budget (`TOKENS_LIMIT`: percentage/nextResetTime), plus the plan
 * `level`.
 *
 * Cached with a short TTL and in-flight dedupe: the bottom-bar badge polls
 * it, and a manual refresh can bypass the cache.
 *
 * @module dsh-zcode/quota
 */

import { BIGMODEL_API_ORIGIN } from './bigmodel-pat.ts'
import type { ZcodeGrant } from './types.ts'
import type { ZcodeQuotaDoc, ZcodeQuotaLimit } from './webui-protocol.ts'

/** How long one snapshot serves; the official client's usage pages poll on the same order. */
const CACHE_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000

/** Numeric fields copied through when finite; the guard below keeps the wire honest. */
const NUMERIC_FIELDS = ['unit', 'usage', 'currentValue', 'remaining', 'percentage', 'nextResetTime'] as const

function normalizeLimit(entry: Record<string, unknown>): ZcodeQuotaLimit | undefined {
  if (typeof entry.type !== 'string' || entry.type.length === 0) return undefined
  const limit: ZcodeQuotaLimit = { type: entry.type }
  const writable = limit as unknown as Record<string, unknown>
  for (const field of NUMERIC_FIELDS) {
    const value = entry[field]
    if (typeof value === 'number' && Number.isFinite(value)) writable[field] = value
  }
  return limit
}

/** Strip a failure to text safe for the browser, mirroring the webui's redaction rules. */
function quotaErrorText(error: unknown): string {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error)
  return message
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/([?&](?:token|access_token|code)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 300)
}

export class BigModelQuotaClient {
  private cached: { at: number, doc: ZcodeQuotaDoc } | undefined
  private pending: Promise<ZcodeQuotaDoc> | undefined

  constructor(private readonly deps: {
    loadGrant: () => Promise<ZcodeGrant | undefined>
    origin?: string
  }) {}

  /**
   * Read the quota snapshot.
   * @param force - bypass the cache TTL (manual refresh).
   * @returns the quota document for the browser; never throws.
   */
  async snapshot(force = false): Promise<ZcodeQuotaDoc> {
    if (!force && this.cached !== undefined && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.doc
    }
    if (this.pending !== undefined) return this.pending
    const origin = this.deps.origin ?? BIGMODEL_API_ORIGIN
    this.pending = (async () => {
      const grant = await this.deps.loadGrant()
      if (grant === undefined) return { status: 'signed-out', fetchedAt: Date.now() } as ZcodeQuotaDoc
      try {
        const response = await fetch(`${origin}/api/monitor/usage/quota/limit`, {
          method: 'GET',
          headers: { Authorization: grant.accessToken, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        const raw: unknown = await response.json().catch(() => null)
        if (typeof raw !== 'object' || raw === null) throw new Error('quota endpoint returned no JSON')
        const envelope = raw as { code?: unknown, msg?: unknown, data?: unknown }
        // This endpoint answers the code-200 business envelope (code 0 tolerated).
        if (envelope.code !== 200 && envelope.code !== 0) {
          throw new Error(`quota endpoint failed (code ${String(envelope.code)}${typeof envelope.msg === 'string' ? `: ${envelope.msg}` : ''})`)
        }
        const data = typeof envelope.data === 'object' && envelope.data !== null ? envelope.data as Record<string, unknown> : {}
        const limits = Array.isArray(data.limits)
          ? (data.limits as Record<string, unknown>[]).map(normalizeLimit).filter((entry): entry is ZcodeQuotaLimit => entry !== undefined)
          : []
        const level = typeof data.level === 'string' && data.level.trim() !== '' ? data.level.trim() : undefined
        const doc: ZcodeQuotaDoc = {
          status: 'ok',
          fetchedAt: Date.now(),
          ...(level === undefined ? {} : { level }),
          ...(limits.length === 0 ? {} : { limits }),
        }
        this.cached = { at: Date.now(), doc }
        return doc
      } catch (error) {
        return { status: 'error', fetchedAt: Date.now(), error: quotaErrorText(error) } as ZcodeQuotaDoc
      }
    })()
    try {
      return await this.pending
    } finally {
      this.pending = undefined
    }
  }
}
