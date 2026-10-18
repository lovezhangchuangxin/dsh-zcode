/**
 * Wire contract between the host-side sign-in bridge (webui.ts) and the
 * plugin's browser half (src/client/). Node-free by design so the two esbuild
 * bundles — the Node plugin body and the browser module — both inline it and
 * can never drift apart.
 *
 * @module dsh-zcode/webui-protocol
 */

/** Plugin-owned URL space on the host web server. */
export const ZCODE_UI_STATUS_PATH = '/plugins/dsh-zcode/status'
export const ZCODE_UI_SIGNIN_PATH = '/plugins/dsh-zcode/signin'
export const ZCODE_UI_CANCEL_PATH = '/plugins/dsh-zcode/cancel'
export const ZCODE_UI_SIGNOUT_PATH = '/plugins/dsh-zcode/signout'
export const ZCODE_UI_QUOTA_PATH = '/plugins/dsh-zcode/quota'
export const ZCODE_UI_RESET_PATH = '/plugins/dsh-zcode/reset'
export const ZCODE_UI_RESET_USE_PATH = '/plugins/dsh-zcode/reset/use'

/** Header every state-changing route requires; carries the in-process control key. */
export const ZCODE_UI_CONTROL_HEADER = 'x-dsh-zcode-control'

/** Account facts the status document reports once a grant is stored. */
export interface ZcodeWebAccount {
  userId: string
  username?: string
  grantedAt: number
}

/** One sign-in attempt as the browser sees it. */
export interface ZcodeWebAttempt {
  phase: 'running' | 'succeeded' | 'cancelled' | 'failed'
  /** Latest flow notice: what to tell the human right now. */
  message?: string
  /** Authorization page to open while the attempt runs. */
  url?: string
  /** Terminal failure text, present only on phase 'failed'. */
  error?: string
}

/** The JSON document the status route answers with (and every write route returns after acting). */
export interface ZcodeWebStatus {
  /** In-process key authorizing the write routes; readable only loopback, same-origin. */
  controlKey: string
  /** Stored grant facts, or null while signed out. */
  account: ZcodeWebAccount | null
  /** Live or last attempt of this process, or null when none ran. */
  attempt: ZcodeWebAttempt | null
}

const ATTEMPT_PHASES: ReadonlySet<string> = new Set(['running', 'succeeded', 'cancelled', 'failed'])

/** One quota window/limit as the quota route reports it. */
export interface ZcodeQuotaLimit {
  /** Server limit kind: `TIME_LIMIT` (the 5-hour window), `TOKENS_LIMIT`, … */
  type: string
  /** Window length in the server's unit (TIME_LIMIT: hours), when reported. */
  unit?: number
  usage?: number
  currentValue?: number
  remaining?: number
  /** Percent already used, 0–100. */
  percentage?: number
  /** When this limit resets, epoch milliseconds. */
  nextResetTime?: number
}

/** The JSON document the quota route answers with. */
export interface ZcodeQuotaDoc {
  status: 'ok' | 'signed-out' | 'error'
  fetchedAt: number
  /** Plan tier, e.g. `pro`, when reported. */
  level?: string
  limits?: ZcodeQuotaLimit[]
  /** Terminal failure text, present only on status 'error'. */
  error?: string
}

/** Reset-availability snapshot for the quota-reset card. */
export interface ZcodeResetDoc {
  status: 'ok' | 'signed-out' | 'error'
  fetchedAt: number
  /** Five-hour resets currently claimable (status 'ok' only). */
  fiveHourAvailable?: number
  /** When the earliest five-hour reset opportunity expires, epoch ms. */
  fiveHourEarliestExpireAt?: number
  /** Week resets currently claimable (status 'ok' only). */
  weekAvailable?: number
  weekEarliestExpireAt?: number
  error?: string
}

/** The result of consuming one five-hour reset. */
export interface ZcodeResetUseDoc {
  status: 'ok' | 'signed-out' | 'error'
  used?: boolean
  error?: string
}

/**
 * Narrow an unknown parsed JSON value to a {@link ZcodeResetDoc}.
 * @param value - anything the route returned.
 * @returns whether the value is a reset document the UI can render.
 */
export function isZcodeResetDoc(value: unknown): value is ZcodeResetDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (doc.status !== 'ok' && doc.status !== 'signed-out' && doc.status !== 'error') return false
  if (doc.status === 'ok' && typeof doc.fetchedAt !== 'number') return false
  if (doc.status === 'ok' && typeof doc.fiveHourAvailable !== 'number') return false
  if (doc.status === 'ok' && typeof doc.weekAvailable !== 'number') return false
  for (const field of ['fiveHourEarliestExpireAt', 'weekEarliestExpireAt'] as const) {
    if (doc[field] !== undefined && (typeof doc[field] !== 'number' || !Number.isFinite(doc[field]))) return false
  }
  if (doc.error !== undefined && (typeof doc.error !== 'string' || doc.error.length === 0)) return false
  return true
}

/**
 * Narrow an unknown parsed JSON value to a {@link ZcodeResetUseDoc}.
 * @param value - anything the route returned.
 * @returns whether the value is a use result the UI can render.
 */
export function isZcodeResetUseDoc(value: unknown): value is ZcodeResetUseDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (doc.status !== 'ok' && doc.status !== 'signed-out' && doc.status !== 'error') return false
  if (doc.used !== undefined && doc.used !== true) return false
  if (doc.error !== undefined && (typeof doc.error !== 'string' || doc.error.length === 0)) return false
  return true
}

/**
 * Narrow an unknown parsed JSON value to a {@link ZcodeQuotaDoc}.
 * @param value - anything the route returned.
 * @returns whether the value is a quota document the UI can render.
 */
export function isZcodeQuotaDoc(value: unknown): value is ZcodeQuotaDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (doc.status !== 'ok' && doc.status !== 'signed-out' && doc.status !== 'error') return false
  if (typeof doc.fetchedAt !== 'number') return false
  if (doc.level !== undefined && typeof doc.level !== 'string') return false
  if (doc.error !== undefined && (typeof doc.error !== 'string' || doc.error.length === 0)) return false
  const limits = doc.limits
  if (limits !== undefined) {
    if (!Array.isArray(limits)) return false
    for (const entry of limits) {
      if (typeof entry !== 'object' || entry === null) return false
      const limit = entry as Record<string, unknown>
      if (typeof limit.type !== 'string' || limit.type.length === 0) return false
      for (const field of ['unit', 'usage', 'currentValue', 'remaining', 'percentage', 'nextResetTime'] as const) {
        if (limit[field] !== undefined && (typeof limit[field] !== 'number' || !Number.isFinite(limit[field]))) return false
      }
    }
  }
  return true
}

/**
 * Narrow an unknown parsed JSON value to a {@link ZcodeWebStatus}. A 200 is
 * not a promise about the body, and storing an unreadable value would put it
 * in React state for the next render to dereference.
 * @param value - anything the route returned.
 * @returns whether the value is a status document the UI can render.
 */
export function isZcodeWebStatus(value: unknown): value is ZcodeWebStatus {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (typeof doc.controlKey !== 'string' || doc.controlKey.length === 0) return false
  const account = doc.account
  if (account !== null) {
    if (typeof account !== 'object') return false
    const facts = account as Record<string, unknown>
    if (typeof facts.userId !== 'string' || facts.userId.length === 0) return false
    if (facts.username !== undefined && typeof facts.username !== 'string') return false
    if (typeof facts.grantedAt !== 'number') return false
  }
  const attempt = doc.attempt
  if (attempt !== null) {
    if (typeof attempt !== 'object') return false
    const state = attempt as Record<string, unknown>
    if (typeof state.phase !== 'string' || !ATTEMPT_PHASES.has(state.phase)) return false
    for (const field of ['message', 'url', 'error'] as const) {
      if (state[field] !== undefined && typeof state[field] !== 'string') return false
    }
  }
  return true
}
