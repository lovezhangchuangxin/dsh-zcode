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
