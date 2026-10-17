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

export const name = 'dsh-zcode'
export const inject = ['llm']
export { Config }

const PROVIDER = 'zcode-glm'
const CREDENTIAL_KEY: CredentialKey = credentialKey(name, 'zcode-glm')

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

  const adapter = new ZcodeGlmAdapter({
    provider: PROVIDER,
    providerName: 'ZCode GLM',
    baseURL: config.baseURL,
    models: resolveModels(config.models),
    ...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
    defaultMaxTokens: config.defaultMaxTokens,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    loadGrant: readGrant,
    sourceHeaders: buildZcodeSourceHeaders({
      appVersion: config.appVersion,
      releaseChannel: 'production',
      ...(config.deviceMid ? { deviceMid: config.deviceMid } : {}),
    }),
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
  })

  ctx.logger.info('dsh-zcode: provider "%s" registered (%d models)', PROVIDER, adapter.modelCount())
}
