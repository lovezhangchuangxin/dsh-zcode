/**
 * Stable device identity for the ZCode source headers.
 *
 * The official client generates one UUID at install time and keeps sending it;
 * the plugin mirrors that with a record in the dsh credential store — created
 * on first use, stable across restarts and sign-ins, surviving sign-out, so
 * the identity reads like one long-lived installation. An explicit
 * `deviceMid` config wins over the stored id, and a host without the
 * credentials service simply sends no device header.
 *
 * @module dsh-zcode/device-id
 */

import { randomUUID } from 'node:crypto'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** The store record holding this installation's device id. */
const DEVICE_KEY: CredentialKey = credentialKey('dsh-zcode', 'device')

/** The structural slice of the credentials service this module needs. */
export interface DeviceIdStore {
  modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined>
}

/** Read the id out of the device record's payload, whatever else sits there. */
function deviceIdOf(record: CredentialRecord | undefined): string | undefined {
  if (record?.kind !== 'grant') return undefined
  const id = (record.payload as { id?: unknown } | null)?.id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/**
 * Create the resolver the adapter calls once per request.
 * @param deps - the configured override (empty honors the stored id) and the
 *   credentials-store getter, read lazily so a late-arriving service still works.
 * @returns the memoized device-id resolver; undefined until an id exists.
 */
export function createDeviceMidResolver(deps: {
  configured: string
  getStore: () => DeviceIdStore | undefined
}): () => Promise<string | undefined> {
  let cached: string | undefined
  return async () => {
    const configured = deps.configured.trim()
    if (configured !== '') return configured
    if (cached !== undefined) return cached
    const store = deps.getStore()
    // No store yet (headless host, service still starting): omit the header
    // this request; a later call re-reads rather than caching the absence.
    if (store === undefined) return undefined
    try {
      // Replaces a missing or corrupted record; a present valid one is kept,
      // which is what makes the id stable across restarts and sign-outs.
      const record = await store.modifyRecord(DEVICE_KEY, async (current) =>
        deviceIdOf(current) === undefined
          ? { kind: 'grant' as const, payload: { id: randomUUID(), createdAt: Date.now() } }
          : current)
      cached = deviceIdOf(record)
      return cached
    } catch {
      return undefined
    }
  }
}
