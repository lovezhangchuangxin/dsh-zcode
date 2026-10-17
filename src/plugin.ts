/**
 * dsh-zcode: use the Zhipu GLM Coding Plan inside DeepSeek Harness.
 *
 * One provider route `zcode-glm` backed by an Anthropic Messages adapter, one
 * authorization flow ("ZCode (BigModel)") running the zcode.z.ai polling
 * sign-in, and per-request short-lived project tokens that carry the official
 * client identity.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ZcodeGlmAdapter } from './adapter.ts'
import { buildZcodeSourceHeaders } from './source-headers.ts'
import { Config, type Config as ConfigType } from './config.ts'
import { isGrantRecord, type ZcodeGrant } from './types.ts'
import { resolveModels } from './models.ts'
import { runZcodeLogin } from './zcode-oauth.ts'
import { registerZcodeWebUi } from './webui.ts'
import { createDeviceMidResolver, type DeviceIdStore } from './device-id.ts'

export const name = 'dsh-zcode'
export const inject = ['llm']
export { Config }

const PROVIDER = 'zcode-glm'
const CREDENTIAL_KEY: CredentialKey = credentialKey(name, 'zcode-glm')
/** The pre-`/v1` default; a profile that stored it would 404 every request. */
const LEGACY_BASE_URL = /^https:\/\/open\.bigmodel\.cn\/api\/anthropic\/?$/

/** Normalize a configured baseURL, migrating the legacy default onto `/v1`. */
function resolveBaseURL(ctx: Context, configured: string): string {
  const trimmed = configured.trim()
  if (!LEGACY_BASE_URL.test(trimmed)) return configured
  ctx.logger.warn('dsh-zcode: baseURL %s predates the /v1 endpoint; using %s/v1', trimmed, trimmed.replace(/\/+$/, ''))
  return `${trimmed.replace(/\/+$/, '')}/v1`
}

export function apply(ctx: Context, config: ConfigType): void {
  const readGrant = async (): Promise<ZcodeGrant | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    const record: CredentialRecord | undefined = await credentials.readRecord(CREDENTIAL_KEY)
    if (record === undefined || record.kind !== 'grant') return undefined
    return isGrantRecord(record.payload) ? record.payload : undefined
  }

  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: 'ZCode GLM (Coding Plan)',
      settingsNs: (ctx.fiber as { entry?: { options?: { id?: string } } }).entry?.options?.id ?? name,
      settingsPath: [],
      // Keyless route: authentication is the ZCode account sign-in below.
      nativeAuth: { env: [], oauth: true },
    },
  ])

  // Device identity mirrors the official client's install-time UUID: generated
  // on first use, persisted in the credential store, stable across restarts
  // and sign-outs. An explicit config value always wins.
  const resolveDeviceMid = createDeviceMidResolver({
    configured: config.deviceMid,
    getStore: () => ctx.get('credentials') as DeviceIdStore | undefined,
  })

  const adapter = new ZcodeGlmAdapter({
    provider: PROVIDER,
    providerName: 'ZCode GLM',
    baseURL: resolveBaseURL(ctx, config.baseURL),
    models: resolveModels(config.models),
    ...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
    defaultMaxTokens: config.defaultMaxTokens,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    loadGrant: readGrant,
    sourceHeaders: buildZcodeSourceHeaders({
      appVersion: config.appVersion,
      releaseChannel: 'production',
    }),
    resolveDeviceMid,
    clientVersion: config.appVersion,
  })
  ctx.llm.registerAdapter([PROVIDER], adapter)

  // The sign-in flow needs both seam services; register in a child context so
  // a host without the authorization service simply skips sign-in.
  ctx.inject(['authorization', 'credentials'], (child) => {
    child.authorization.registerFlow({
      key: CREDENTIAL_KEY,
      label: 'ZCode (BigModel)',
      methods: [{ id: 'oauth', label: 'Sign in with BigModel' }],
      async run(session) {
        const grant = await runZcodeLogin({
          notify: (message, url) => session.notify({ message, ...(url ? { url } : {}) }),
          signal: session.signal,
        })
        await session.commit({
          kind: 'grant',
          payload: { ...grant, grantedAt: Date.now() },
        })
      },
    })
    // Create the device record at boot — the equivalent moment to the
    // official client's install-time generation — so the first inference
    // request already carries a stable X-Device-Mid.
    void resolveDeviceMid()
  })

  // The harness ships no generic surface listing authorization flows, so the
  // plugin brings its own: loopback routes on the host web server plus a
  // Settings page in the browser half (lib/client.js).
  registerZcodeWebUi(ctx, { key: CREDENTIAL_KEY, readGrant })

  ctx.logger.info('dsh-zcode: provider "%s" registered (%d models)', PROVIDER, adapter.modelCount())
}
