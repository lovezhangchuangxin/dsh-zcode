/**
 * Host half of the sign-in UI: four loopback routes on the host web server
 * that drive the authorization flow plugin.ts registers, so the plugin's own
 * Settings page can offer the sign-in the harness ships no generic surface
 * for (its account page is hardwired to the DeepSeek platform flow).
 *
 *   GET  /plugins/dsh-zcode/status   the whole state document — including the
 *                                    in-process control key every write route
 *                                    requires, readable only loopback and
 *                                    same-origin, so only a page this host
 *                                    served can pick it up
 *   POST /plugins/dsh-zcode/signin   start one attempt (a no-op report while
 *                                    one is already running)
 *   POST /plugins/dsh-zcode/cancel   withdraw the running attempt
 *   POST /plugins/dsh-zcode/signout  delete the stored grant
 *
 * @module dsh-zcode/webui
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { ZcodeGrant } from './types.ts'
import {
  ZCODE_UI_CANCEL_PATH, ZCODE_UI_CONTROL_HEADER, ZCODE_UI_SIGNIN_PATH, ZCODE_UI_SIGNOUT_PATH,
  ZCODE_UI_STATUS_PATH, type ZcodeWebAttempt, type ZcodeWebStatus,
} from './webui-protocol.ts'

/**
 * The slice of `ctx.webServer` (`@deepseek-ai/dsh-host-webserver`) this
 * bridge uses, restated locally so the plugin keeps no type-level dependency
 * on a package outside the boot redirect set. Shape-faithful: `register()`
 * takes an exact route and answers with its disposer.
 */
interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Hostnames the web app itself binds; anything else is not this UI's client. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1'])

/** First header value, folded for the rare multi-value header Node produces. */
function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** Hostname part of a Host header, IPv6 bracket form included. */
function hostHostname(host: string): string {
  const bracketed = /^\[([^\]]+)\]/.exec(host)
  if (bracketed !== null) return bracketed[1] ?? ''
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/**
 * A request this UI serves: the Host header must name a loopback address, and
 * a present Origin (browsers send one on POST) must too. A DNS-rebinding page
 * dies here, and so does any non-loopback client; non-browser local tools,
 * which send no Origin, pass.
 */
function loopbackRequest(req: IncomingMessage): boolean {
  const host = header(req, 'host')
  if (host === undefined || host.trim() === '') return false
  if (!LOOPBACK_HOSTNAMES.has(hostHostname(host))) return false
  const origin = header(req, 'origin')
  if (origin === undefined || origin.trim() === '') return true
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** Constant-time control-key comparison; a length mismatch is a failure, not a crash. */
function controlKeyMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined || presented.length !== expected.length) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(presented)
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Failure text safe to show a human: redacted, truncated, message or code. */
function errorText(error: unknown): string {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error)
  return message
    // JWT-shaped secrets and query-parameter credentials never belong in a
    // status document the browser renders.
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>')
    .replace(/([?&](?:token|access_token|code)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 500)
}

/** What the bridge needs from the plugin. */
export interface ZcodeWebUiDeps {
  /** Credential record the sign-in flow commits. */
  key: CredentialKey
  /** Current stored grant, or undefined while signed out. */
  readGrant: () => Promise<ZcodeGrant | undefined>
}

/**
 * Mount the sign-in routes. The seam services arrive together or not at all —
 * a host without the web server (a headless profile) simply gets no UI and
 * keeps the provider.
 * @param ctx - plugin context.
 * @param deps - the record key and the grant reader.
 */
export function registerZcodeWebUi(ctx: Context, deps: ZcodeWebUiDeps): void {
  // Rotates every process start: a key from a previous run is stale on purpose.
  const controlKey = randomBytes(24).toString('hex')
  const attempt: {
    current: ZcodeWebAttempt | null
    /** The settling promise of the live begin() attempt, if one runs; never rejects. */
    pending: Promise<void> | undefined
  } = { current: null, pending: undefined }

  const status = async (): Promise<ZcodeWebStatus> => {
    const grant = await deps.readGrant()
    return {
      controlKey,
      account: grant === undefined ? null : {
        userId: grant.userId,
        ...(grant.username !== undefined ? { username: grant.username } : {}),
        grantedAt: grant.grantedAt,
      },
      attempt: attempt.current,
    }
  }

  ctx.inject(['authorization', 'credentials', 'webServer'], (child) => {
    child.effect(() => {
      const webServer = (child as unknown as { webServer: WebServerLike }).webServer

      const handleStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!loopbackRequest(req)) {
          json(res, 403, { error: 'request not trusted' })
          return
        }
        json(res, 200, await status())
      }

      /** The three checks every write route shares, in the order they must run. */
      const guardWrite = (req: IncomingMessage, res: ServerResponse): boolean => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' })
          return false
        }
        if (!loopbackRequest(req)) {
          json(res, 403, { error: 'request not trusted' })
          return false
        }
        if (!controlKeyMatches(controlKey, header(req, ZCODE_UI_CONTROL_HEADER))) {
          json(res, 401, { error: 'control key missing or wrong' })
          return false
        }
        return true
      }

      const handleSignIn = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!guardWrite(req, res)) return
        // One attempt per key at a time is the seam's rule; a second click
        // while one runs reports the live attempt instead of failing.
        if (attempt.current?.phase === 'running') {
          json(res, 200, await status())
          return
        }
        attempt.current = { phase: 'running' }
        const outcome = child.authorization.begin({
          key: deps.key,
          interaction: {
            notify: (notice) => {
              // Notices from an attempt that already ended must not resurrect it.
              if (attempt.current?.phase !== 'running') return
              attempt.current.message = notice.message
              if (notice.url !== undefined) attempt.current.url = notice.url
            },
            // The ZCode flow converses through notices only; a prompt here
            // means the flow changed shape and the human must not wait on a
            // surface that cannot answer.
            prompt: () => Promise.reject(new Error('dsh-zcode: the sign-in flow asked a question the web surface cannot answer')),
          },
        })
        // Settled here, never rejected: cancel/sign-out await this promise so a
        // terminal write cannot land after they answered.
        attempt.pending = (async () => {
          try {
            const result = await outcome
            attempt.current = result.status === 'authorized'
              ? { phase: 'succeeded' }
              : { phase: 'cancelled' }
          } catch (error) {
            const code = (error as { code?: unknown }).code
            attempt.current = typeof code === 'string' && code === 'ALREADY_IN_FLIGHT'
              // Another surface owns the key's one attempt; report it live.
              ? { phase: 'running' }
              : { phase: 'failed', error: errorText(error) }
          } finally {
            attempt.pending = undefined
          }
        })()
        json(res, 200, await status())
      }

      const handleCancel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!guardWrite(req, res)) return
        child.authorization.cancel(deps.key)
        // Let the attempt settle first so the answer carries its terminal phase.
        await attempt.pending
        json(res, 200, await status())
      }

      const handleSignOut = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!guardWrite(req, res)) return
        // Withdraw first and wait: a settling attempt must not write its
        // terminal state over the sign-out that removed the record.
        child.authorization.cancel(deps.key)
        await attempt.pending
        await child.credentials.deleteRecord(deps.key)
        attempt.current = null
        json(res, 200, await status())
      }

      /** Wrap one handler so an internal failure answers 500 instead of leaving an unhandled rejection. */
      const respond = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
        async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
          try {
            await handler(req, res)
          } catch (error) {
            ctx.logger.warn('dsh-zcode: a web sign-in route failed')
            ctx.logger.warn(error)
            if (!res.headersSent) json(res, 500, { error: 'internal error' })
          }
        }

      const disposers = [
        webServer.register({ kind: 'exact', path: ZCODE_UI_STATUS_PATH, handler: respond(handleStatus) }),
        webServer.register({ kind: 'exact', path: ZCODE_UI_SIGNIN_PATH, handler: respond(handleSignIn) }),
        webServer.register({ kind: 'exact', path: ZCODE_UI_CANCEL_PATH, handler: respond(handleCancel) }),
        webServer.register({ kind: 'exact', path: ZCODE_UI_SIGNOUT_PATH, handler: respond(handleSignOut) }),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-zcode: web sign-in routes')
  })
}
