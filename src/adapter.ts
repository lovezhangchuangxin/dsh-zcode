/**
 * GLM Coding Plan adapter speaking the Anthropic Messages wire protocol.
 *
 * One cancellable lifecycle per model request. Authentication is resolved per
 * request: a short-lived project token (PAT) plus the ZCode client source
 * headers, so the provider-side metering sees the official-client identity.
 * A 401 with a recognized PAT fingerprint rejects that token generation and
 * the request fails once with a stable code; the next request re-issues.
 */

import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, Message, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BigModelPatClient, fingerprintOf } from './bigmodel-pat.ts'
import { PatError } from './types.ts'
import { GLM_REASONING_EFFORTS, type GlmModelEntry } from './models.ts'
import { serialize, type ReplaySignatures } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'

export interface ZcodeAdapterOptions {
  provider: string
  providerName: string
  /** Messages endpoint root, e.g. https://open.bigmodel.cn/api/anthropic/v1 */
  baseURL: string
  models: readonly GlmModelEntry[]
  defaultEffort?: string
  defaultMaxTokens: number
  streamIdleTimeoutMs: number
  /** Read the stored sign-in grant; resolves undefined when signed out. */
  loadGrant: () => Promise<{ accessToken: string; userId: string } | undefined>
  /** Client identity headers mirroring the official ZCode app. */
  sourceHeaders: Record<string, string>
  /** Client version reported at PAT issuance. */
  clientVersion: string
}

export class ZcodeGlmAdapter extends LlmAdapter {
  private readonly pat = new BigModelPatClient()

  constructor(private readonly options: ZcodeAdapterOptions) {
    super()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.options.providerName }
  }

  override async listModels(provider: string): Promise<LlmModelInfo[]> {
    return this.options.models.map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
      inputModalities: ['text' as const],
    }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const entry = this.options.models.find(candidate => candidate.id === model)
    if (entry === undefined) {
      throw new LlmError(`zcode-glm: unknown model "${model}"`, 'UNKNOWN_MODEL')
    }
    return {
      provider,
      id: entry.id,
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      inputModalities: ['text' as const],
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: entry.maxTokens,
      ...(entry.thinking
        ? {
            reasoning: {
              efforts: GLM_REASONING_EFFORTS,
              ...(this.options.defaultEffort
                ? { defaultEffort: ReasoningEffortId(this.options.defaultEffort) }
                : {}),
            },
          }
        : {}),
    }
  }

  override async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) }
  }

  /** Catalog size for startup diagnostics. */
  modelCount(): number {
    return this.options.models.length
  }

  override async * stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const grant = await this.options.loadGrant()
    if (grant === undefined) {
      throw new LlmError(
        'zcode-glm: not signed in; open Settings to authorize the ZCode (BigModel) account',
        'MISSING_CREDENTIAL',
      )
    }
    let material
    try {
      material = await this.pat.resolve({
        loginToken: grant.accessToken,
        accountId: grant.userId,
        clientVersion: this.options.clientVersion,
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof PatError) {
        // Login-scoped failures read as actionable sign-in guidance, not transport noise.
        throw new LlmError(
          error.code === 'zcode_not_signed_in'
            ? 'zcode-glm: not signed in; open Settings to authorize the ZCode (BigModel) account'
            : `zcode-glm: ZCode credential unavailable (${error.code}); sign in again if this persists`,
          'MISSING_CREDENTIAL',
        )
      }
      throw error
    }
    const fingerprint = fingerprintOf(material.token)

    const replayByMessage = collectReplay(options.messages, options.model)
    const body = serialize(
      options,
      {
        models: this.options.models,
        defaultMaxTokens: this.options.defaultMaxTokens,
        defaultEffort: this.options.defaultEffort,
      },
      replayByMessage,
    )

    let response: Response
    try {
      response = await fetch(`${this.options.baseURL.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify(body),
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'accept': 'text/event-stream',
        'anthropic-version': '2023-06-01',
        // Both spellings are accepted by the GLM gateway; the source headers
        // (including User-Agent) mirror the official ZCode client.
        'x-api-key': material.token,
        'Authorization': `Bearer ${material.token}`,
        ...this.options.sourceHeaders,
      },
      })
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('zcode-glm: request aborted', 'ABORTED', { cause: error })
      throw new LlmError('zcode-glm: Messages endpoint unreachable', 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      const text = await response.text()
      if (response.status === 401 || response.status === 403) {
        // Reject only this PAT generation; a late 401 must not kill a fresh one.
        this.pat.reject(fingerprint)
      }
      throw new LlmError(
        providerFailureMessage(text, response.status),
        providerFailureCode(response.status),
        { status: response.status, cause: new Error(text) },
      )
    }
    if (response.body === null) throw new LlmError('zcode-glm: no response body', 'EMPTY_RESPONSE')

    // Idle watchdog: one timer rearmed by every SSE frame; on expiry the body
    // is cancelled, which settles the pending read and surfaces TIMEOUT below.
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const pulse = () => {
      if (timedOut) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        void response.body?.cancel().catch(() => {})
      }, this.options.streamIdleTimeoutMs)
    }
    pulse()
    try {
      for await (const chunk of translate(parseSse(response.body, pulse), options.model)) {
        if (timedOut) break
        yield chunk
      }
      if (timedOut) throw new LlmError('zcode-glm: Messages stream idle timeout', 'TIMEOUT')
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('zcode-glm: request aborted', 'ABORTED', { cause: error })
      if (timedOut) throw new LlmError('zcode-glm: Messages stream idle timeout', 'TIMEOUT')
      if (error instanceof LlmError) throw error
      throw new LlmError('zcode-glm: Messages transport failed', 'TRANSPORT', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Recover replay signatures indexed by assistant message identity. Thinking
 * signatures are not portable across models: a history block keeps its
 * signature only when the stored replay was produced by the model this
 * request targets (same rule as the reference DeepSeek adapter).
 */
function collectReplay(
  messages: readonly { role: string }[], model: string,
): Map<Message, ReplaySignatures> {
  const map = new Map<Message, ReplaySignatures>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const source = (message as unknown as {
      source?: { model?: string; replayState?: { response?: { model?: string }; blocks?: readonly unknown[] } }
    }).source
    const blocks = source?.replayState?.blocks
    if (!Array.isArray(blocks)) continue
    const replayModel = source?.replayState?.response?.model ?? source?.model
    if (replayModel !== undefined && replayModel !== model) continue
    const signatures = blocks.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    if (signatures.length > 0) map.set(message as Message, { signatures })
  }
  return map
}

function providerFailureMessage(text: string, status: number): string {
  try {
    const raw = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = raw.error?.message ?? raw.message
    if (typeof message === 'string' && message.trim()) {
      return `zcode-glm: ${message.trim()} (HTTP ${status})`
    }
  } catch {
    // Non-JSON gateway body: HTTP status is authoritative.
  }
  return `zcode-glm: provider request failed (HTTP ${status})`
}

function providerFailureCode(status: number): string {
  if (status === 401 || status === 403) return 'MISSING_CREDENTIAL'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'PROVIDER_ERROR'
  return 'INVALID_REQUEST'
}
