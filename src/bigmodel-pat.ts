/**
 * BigModel short-lived project access tokens (PAT) for Coding Plan inference.
 *
 * Faithful port of the official ZCode client chain:
 *   1. GET  /api/biz/customer/getCustomerInfo   (Authorization: raw login token)
 *   2. pick "默认机构/默认项目" (non-team, projectType != 2)
 *   3. GET/POST .../api_keys                    (find or create "zcode-api-key")
 *   4. POST .../api_keys/{id}/access_tokens     (clientType: "zcode") -> PAT
 * The PAT is cached in memory and refreshed ~2 min before expiry, matching the
 * official cache policy (120 s lead + up to 60 s jitter).
 */

import { createHash } from 'node:crypto'
import { PatError, type PatMaterial } from './types.ts'

export const BIGMODEL_API_ORIGIN = 'https://bigmodel.cn'
const ZCODE_API_KEY_NAME = 'zcode-api-key'
const USAGE_SCENE_CODING_PLAN = 'CODING_PLAN'
const REFRESH_LEAD_MS = 120_000
const REFRESH_JITTER_MS = 60_000

/** Declared client identity sent when issuing tokens; mirrors the official app. */
export const ZCODE_CLIENT_TYPE = 'zcode'

interface Envelope {
  code?: number
  msg?: string
  data?: unknown
}

function readData(envelope: Envelope): unknown {
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw new PatError('zcode_invalid_response')
  }
  return envelope.data
}

async function requestJson(url: string, init: RequestInit): Promise<{ envelope: Envelope; status: number }> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new PatError('zcode_request_failed')
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    // A 401/403 with a non-JSON body still means the login token expired.
    if (response.status === 401 || response.status === 403) throw new PatError('zcode_login_expired')
    throw new PatError('zcode_invalid_response')
  }
  if (typeof raw !== 'object' || raw === null) throw new PatError('zcode_invalid_response')
  return { envelope: raw as Envelope, status: response.status }
}

interface KeyLocation {
  organizationId: string
  projectId: string
  apiKeyId: string
}

async function resolveLocation(
  loginToken: string, signal: AbortSignal | undefined, origin: string,
): Promise<KeyLocation> {
  // BigModel business endpoints take the raw token, without a Bearer prefix.
  const { envelope: customer, status } = await requestJson(`${origin}/api/biz/customer/getCustomerInfo`, {
    method: 'GET',
    headers: { Authorization: loginToken, 'Content-Type': 'application/json' },
    signal,
  })
  if (status === 401 || status === 403) throw new PatError('zcode_login_expired')
  const data = readData(customer)
  const organizations =
    typeof data === 'object' && data !== null && Array.isArray((data as { organizations?: unknown }).organizations)
      ? ((data as { organizations: unknown[] }).organizations as Record<string, unknown>[])
      : []
  const personal = organizations
    .map((organization) => ({
      organizationId: trimmed(organization.organizationId),
      organizationName: trimmed(organization.organizationName),
      projects: Array.isArray(organization.projects)
        ? (organization.projects as Record<string, unknown>[]).filter(
            (project) => projectTypeOf(project) !== '2' && trimmed(project.projectId),
          )
        : [],
    }))
    .filter((organization) => organization.organizationId && organization.projects.length > 0)
  if (personal.length === 0) throw new PatError('zcode_project_unavailable')
  const organization =
    personal.find((entry) => entry.organizationName?.includes('默认机构')) ?? personal[0]!
  const project =
    organization.projects.find((entry) => trimmed(entry.projectName)?.includes('默认项目')) ??
    organization.projects[0]!
  const organizationId = trimmed(organization.organizationId)!
  const projectId = trimmed(project.projectId)!
  const keyListUrl = `${origin}/api/biz/v1/organization/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/api_keys`
  const { envelope: list } = await requestJson(keyListUrl, {
    method: 'GET',
    headers: { Authorization: loginToken, 'Content-Type': 'application/json' },
    signal,
  })
  const listData = readData(list)
  const entries = Array.isArray(listData) ? (listData as Record<string, unknown>[]) : []
  const candidate = entries.find(
    (entry) => trimmed(entry.name) === ZCODE_API_KEY_NAME && trimmed(entry.apiKey),
  )
  if (candidate && trimmed(candidate.apiKey)) {
    return {
      organizationId,
      projectId,
      apiKeyId: trimmed(candidate.apiKey)!,
    }
  }
  const { envelope: created } = await requestJson(keyListUrl, {
    method: 'POST',
    headers: { Authorization: loginToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ZCODE_API_KEY_NAME, usageScene: USAGE_SCENE_CODING_PLAN }),
    signal,
  })
  const createdData = readData(created)
  const apiKeyId =
    typeof createdData === 'object' && createdData !== null
      ? trimmed((createdData as Record<string, unknown>).apiKey)
      : undefined
  if (!apiKeyId) throw new PatError('zcode_api_key_unavailable')
  return {
    organizationId,
    projectId,
    apiKeyId,
  }
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function projectTypeOf(project: Record<string, unknown>): string {
  const value = project.projectType
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

interface CacheEntry {
  fingerprint?: string
  value?: { token: string; expiresAt: number }
  refreshAt?: number
  pending?: Promise<{ token: string; expiresAt: number }>
  location?: KeyLocation
}

/** One login generation's PAT state; dropped when the sign-in changes. */
export class BigModelPatClient {
  readonly #entries = new Map<string, CacheEntry>()

  /** Forget one PAT generation after its token drew a 401. */
  reject(fingerprint: string): void {
    for (const entry of this.#entries.values()) {
      if (entry.fingerprint === fingerprint) {
        entry.value = undefined
        entry.refreshAt = undefined
      }
    }
  }

  /** Drop every cached token (sign-out or login change). */
  clear(): void {
    this.#entries.clear()
  }

  async resolve(input: {
    loginToken: string
    accountId: string
    clientVersion: string
    origin?: string
    signal?: AbortSignal
  }): Promise<PatMaterial> {
    const origin = input.origin ?? BIGMODEL_API_ORIGIN
    const loginToken = input.loginToken.trim().replace(/^Bearer\s+/i, '')
    if (!loginToken) throw new PatError('zcode_not_signed_in')
    const key = JSON.stringify([origin, input.accountId])
    let entry = this.#entries.get(key)
    if (entry?.pending) return withLocation(await entry.pending, entry.location)
    if (entry?.value && Date.now() < Math.min(entry.refreshAt ?? 0, entry.value.expiresAt)) {
      return withLocation(entry.value, entry.location)
    }
    if (!entry) {
      entry = {}
      this.#entries.set(key, entry)
    }
    const current = entry
    const pending = (async () => {
      // Reuse the resolved key location across refreshes of one login; a hard
      // failure clears the whole entry so the next attempt re-locates.
      const location = current.location ?? await resolveLocation(loginToken, input.signal, origin)
      current.location = location
      const { envelope: response, status } = await requestJson(
        `${origin}/api/biz/v1/organization/${encodeURIComponent(location.organizationId)}/projects/${encodeURIComponent(location.projectId)}/api_keys/${encodeURIComponent(location.apiKeyId)}/access_tokens`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${loginToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientType: ZCODE_CLIENT_TYPE, clientVersion: input.clientVersion }),
          signal: input.signal,
        },
      )
      if (status === 404) current.location = undefined
      if (status === 401 || status === 403) throw new PatError('zcode_login_expired')
      const data = readData(response)
      if (typeof data !== 'object' || data === null) throw new PatError('zcode_invalid_response')
      const fields = data as {
        enable?: unknown
        accessToken?: unknown
        expiresIn?: unknown
        expiresAt?: unknown
      }
      if (fields.enable === false) throw new PatError('zcode_token_disabled')
      const token = trimmed(fields.accessToken)
      const expiresIn = Number(fields.expiresIn)
      const expiresAtSec = Number(fields.expiresAt)
      if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new PatError('zcode_invalid_response')
      }
      const startedAt = Date.now()
      const expiresAt = Math.min(expiresAtSec * 1_000, startedAt + expiresIn * 1_000)
      if (expiresAt <= startedAt) throw new PatError('zcode_invalid_response')
      const value = { token, expiresAt }
      current.value = value
      current.fingerprint = fingerprintOf(token)
      const jitter = Math.random() * REFRESH_JITTER_MS
      current.refreshAt = expiresAt - REFRESH_LEAD_MS - jitter
      return value
    })()
    current.pending = pending
    try {
      return withLocation(await pending, current.location)
    } catch (error) {
      this.#entries.delete(key)
      if (error instanceof PatError) throw error
      throw new PatError('zcode_request_failed')
    } finally {
      if (current.pending === pending) current.pending = undefined
    }
  }
}

function withLocation(
  value: { token: string; expiresAt: number },
  location: KeyLocation | undefined,
): PatMaterial {
  if (!location) throw new PatError('zcode_invalid_response')
  return { token: value.token, apiKeyId: location.apiKeyId, organizationId: location.organizationId, projectId: location.projectId }
}

/** SHA-256 hex of a token; compares generations without leaking the secret into logs. */
export function fingerprintOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
