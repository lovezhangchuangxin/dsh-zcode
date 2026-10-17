/** Shared vocabulary of the dsh-zcode plugin: grant payload and token material. */

/** What the credential record stores after one successful ZCode sign-in. */
export interface ZcodeGrant {
  /** BigModel business access token; drives the project-token issuance calls. */
  accessToken: string
  /** BigModel refresh token when the provider returned one; kept for future refresh support. */
  refreshToken?: string
  /** ZCode platform JWT; not needed for Coding Plan inference but kept with the grant. */
  zcodeJwt?: string
  /** Stable BigModel account identity (customer number or user id). */
  userId: string
  username?: string
  avatarUrl?: string
  /** Wall clock of the sign-in, milliseconds; diagnostics only. */
  grantedAt: number
}

/** One issued short-lived project access token plus its location facts. */
export interface PatMaterial {
  token: string
  apiKeyId: string
  organizationId: string
  projectId: string
}

/** Errors raised by the project-token chain, in fixed vocabulary safe to log. */
export type PatErrorCode =
  | 'zcode_not_signed_in'
  | 'zcode_login_expired'
  | 'zcode_customer_unavailable'
  | 'zcode_project_unavailable'
  | 'zcode_api_key_unavailable'
  | 'zcode_token_disabled'
  | 'zcode_invalid_response'
  | 'zcode_request_failed'

export class PatError extends Error {
  constructor(readonly code: PatErrorCode) {
    super(code)
    this.name = 'PatError'
  }
}

export function isGrantRecord(value: unknown): value is ZcodeGrant {
  if (typeof value !== 'object' || value === null) return false
  const grant = value as Record<string, unknown>
  return (
    typeof grant.accessToken === 'string' && grant.accessToken.length > 0 &&
    typeof grant.userId === 'string' && grant.userId.length > 0
  )
}
