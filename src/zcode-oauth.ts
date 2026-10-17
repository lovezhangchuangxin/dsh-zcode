/**
 * ZCode browser sign-in over the zcode.z.ai CLI polling flow.
 *
 * Mirrors the official client's flow (`zcode` app: `POST /api/v1/oauth/cli/init`,
 * then `GET /api/v1/oauth/cli/poll/{flow_id}` with the same random bearer):
 * the browser authorizes on bigmodel.cn and the poll endpoint hands the token
 * set back, so no local callback server or deep link is needed.
 */

import { randomBytes } from 'node:crypto'

export const ZCODE_OAUTH_ORIGIN = 'https://zcode.z.ai'

export interface ZcodePollResult {
  /** BigModel business access token used for project-token issuance. */
  accessToken: string
  refreshToken?: string
  zcodeJwt: string
  userId: string
  username: string
  avatarUrl?: string
}

interface ZcodeFlowEnvelope {
  code?: number
  msg?: string
  data?: Record<string, unknown>
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readData(envelope: ZcodeFlowEnvelope): Record<string, unknown> {
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw new Error(trimmed(envelope.msg) ?? `zcode oauth failed (code ${String(envelope.code)})`)
  }
  if (typeof envelope.data === 'object' && envelope.data !== null) return envelope.data
  throw new Error('zcode oauth response is missing data')
}

async function readJson(response: Response): Promise<ZcodeFlowEnvelope> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new Error(`zcode oauth endpoint returned non-JSON (${response.status})`)
  }
  if (typeof raw === 'object' && raw !== null) return raw as ZcodeFlowEnvelope
  throw new Error('zcode oauth endpoint returned an unexpected body')
}

export interface ZcodeLoginEvents {
  /** Report where the human must go; fire-and-forget like the harness notice. */
  notify(message: string, url?: string): void
  signal?: AbortSignal
}

/**
 * Run the whole sign-in: init, open the browser URL, poll until ready.
 * Resolves with the token set or throws; honors `signal` for cancellation.
 */
export async function runZcodeLogin(options: ZcodeLoginEvents): Promise<ZcodePollResult> {
  const pollToken = randomBytes(32).toString('hex')
  const init = await fetch(`${ZCODE_OAUTH_ORIGIN}/api/v1/oauth/cli/init`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pollToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'bigmodel' }),
    signal: options.signal,
  })
  if (!init.ok) throw new Error(`zcode oauth init failed (${init.status})`)
  const initData = readData(await readJson(init))
  const flowId = trimmed(initData.flow_id)
  const authorizeUrl = trimmed(initData.authorize_url)
  const expiresAt = Number(initData.expires_at)
  const pollIntervalSec = Number(initData.poll_interval_sec)
  if (!flowId || !authorizeUrl || !Number.isFinite(expiresAt) || !Number.isFinite(pollIntervalSec)) {
    throw new Error('zcode oauth init response is invalid')
  }

  options.notify('Opening the BigModel sign-in page in your browser…', authorizeUrl)
  const pollUrl = `${ZCODE_OAUTH_ORIGIN}/api/v1/oauth/cli/poll/${encodeURIComponent(flowId)}`
  const intervalMs = Math.max(1_000, pollIntervalSec * 1_000)

  while (true) {
    options.signal?.throwIfAborted()
    if (Date.now() >= expiresAt * 1_000) throw new Error('zcode oauth flow expired before authorization')
    const response = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${pollToken}` },
      signal: options.signal,
    })
    // A 4xx other than rate limiting is terminal for this flow.
    if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new Error(`zcode oauth poll failed (${response.status})`)
    }
    if (response.ok) {
      const data = readData(await readJson(response))
      const status = trimmed(data.status)
      if (status === 'ready') {
        const bigmodel: Record<string, unknown> =
          typeof data.bigmodel === 'object' && data.bigmodel !== null ? data.bigmodel as Record<string, unknown> : {}
        const user: Record<string, unknown> =
          typeof data.user === 'object' && data.user !== null ? data.user as Record<string, unknown> : {}
        const accessToken = trimmed(bigmodel.access_token) ?? trimmed(bigmodel.accessToken)
        const refreshToken = trimmed(bigmodel.refresh_token) ?? trimmed(bigmodel.refreshToken)
        const zcodeJwt = trimmed(data.token)
        const userId = trimmed(user.user_id)
        if (!accessToken || !zcodeJwt || !userId) throw new Error('zcode oauth ready payload is invalid')
        const username = trimmed(user.name) ?? trimmed(user.email) ?? userId
        const avatar = trimmed(user.avatar)
        return {
          accessToken, ...(refreshToken ? { refreshToken } : {}),
          zcodeJwt, userId, username, ...(avatar ? { avatarUrl: avatar } : {}),
        }
      }
      if (status === 'failed') throw new Error('zcode oauth authorization failed')
      // pending: keep waiting below.
    }
    await sleep(intervalMs, options.signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }, { once: true })
  })
}
