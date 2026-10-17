/**
 * ZCode client source headers, mirroring the official app's shared
 * `buildZCodeSourceHeaders` set: versioned User-Agent, app version, device id,
 * and platform facts. The provider-side metering treats these, together with
 * the PAT issued under `clientType: "zcode"`, as the official-client identity.
 */

import { release } from 'node:os'

export interface ZcodeSourceHeaderOptions {
  appVersion: string
  releaseChannel?: string
  deviceMid?: string
}

function printable(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) return undefined
  return trimmed
}

function osCategory(platform: NodeJS.Platform): 'macos' | 'windows' | 'linux' {
  switch (platform) {
    case 'darwin': return 'macos'
    case 'win32': return 'windows'
    default: return 'linux'
  }
}

export function buildZcodeSourceHeaders(options: ZcodeSourceHeaderOptions): Record<string, string> {
  const appVersion = printable(options.appVersion) ?? '3.15.1'
  const platform = process.platform
  const arch = process.arch
  const locale = printable(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'unknown'
  const timezone = printable(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'unknown'
  const deviceMid = printable(options.deviceMid)
  return {
    'User-Agent': `ZCode/${appVersion}`,
    'HTTP-Referer': 'https://zcode.z.ai',
    'X-Title': 'Z Code@electron',
    'X-ZCode-App-Version': appVersion,
    ...(platform && arch ? { 'X-Platform': `${platform}-${arch}` } : {}),
    ...(options.releaseChannel ? { 'X-Release-Channel': options.releaseChannel } : {}),
    'X-Client-Language': locale,
    'X-Client-Timezone': timezone,
    'X-Os-Category': osCategory(platform),
    ...(printable(release()) ? { 'X-Os-Version': printable(release())! } : {}),
    ...(deviceMid ? { 'X-Device-Mid': deviceMid } : {}),
    'X-ZCode-Agent': 'glm',
  }
}
