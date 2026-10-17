/**
 * Translate GLM Anthropic Messages SSE events into the harness stream
 * protocol: block indexes in first-seen order, cumulative usage, one final
 * finish with native thinking signatures as replay state.
 */

import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

interface Block {
  index: number
  content: Extract<ContentBlock, { type: 'text' | 'reasoning' | 'tool-call' }>
  signature: string
  closed: boolean
  json: string
}

function malformed(detail: string): never {
  throw new LlmError(`zcode-glm: Messages stream: ${detail}`, 'MALFORMED_RESPONSE')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) malformed('expected an object')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') malformed('expected a string field')
  return value
}

function indexOf(event: Record<string, unknown>): number {
  const value = event.index
  if (!Number.isSafeInteger(value) || (value as number) < 0) malformed('invalid block index')
  return value as number
}

function updateUsage(usage: TokenUsage, raw: unknown): void {
  const fields = object(raw)
  const keys = {
    input_tokens: 'inputTokens',
    output_tokens: 'outputTokens',
    cache_read_input_tokens: 'cacheReadTokens',
    cache_creation_input_tokens: 'cacheWriteTokens',
  } as const
  for (const [wire, local] of Object.entries(keys)) {
    const value = fields[wire]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || (value as number) < 0) malformed(`invalid ${wire}`)
    usage[local] = value as number
  }
}

function startBlock(event: Record<string, unknown>, index: number): Block {
  const native = object(event.content_block)
  switch (native.type) {
    case 'text':
      return { index, content: { type: 'text', text: string(native.text) }, signature: '', closed: false, json: '' }
    case 'thinking':
      return { index, content: { type: 'reasoning', text: string(native.thinking) }, signature: typeof native.signature === 'string' ? native.signature : '', closed: false, json: '' }
    case 'tool_use': {
      const id = ToolCallId(string(native.id))
      const name = string(native.name)
      if (!id || !name) malformed('empty tool identity')
      return { index, content: { type: 'tool-call', id, name, arguments: '{}' }, signature: '', closed: false, json: '' }
    }
    default:
      throw new LlmError(`zcode-glm: unsupported response block ${String(native.type)}`, 'UNSUPPORTED_CONTENT')
  }
}

function deltaChunk(block: Block, raw: unknown): StreamChunk | undefined {
  const delta = object(raw)
  const content = block.content
  if (delta.type === 'text_delta' && content.type === 'text') {
    const text = string(delta.text)
    content.text += text
    return { type: 'text-delta', index: block.index, text }
  }
  if (delta.type === 'thinking_delta' && content.type === 'reasoning') {
    const text = string(delta.thinking)
    content.text += text
    return { type: 'reasoning-delta', index: block.index, text }
  }
  if (delta.type === 'signature_delta' && content.type === 'reasoning') {
    block.signature += string(delta.signature)
    return undefined
  }
  if (delta.type === 'input_json_delta' && content.type === 'tool-call') {
    const argumentsDelta = string(delta.partial_json)
    block.json += argumentsDelta
    return { type: 'tool-call-delta', index: block.index, id: content.id, argumentsDelta }
  }
  // GLM compat layers occasionally emit untyped or empty deltas; skip silently
  // rather than failing an otherwise healthy stream.
  return undefined
}

function stopReason(raw: unknown): FinishReason {
  switch (raw) {
    case 'end_turn': case 'stop_sequence': case null: case undefined: case '':
      return { kind: 'stop' }
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    default:
      malformed(`unsupported stop reason ${String(raw)}`)
  }
}

/** Translate decoded SSE events into harness chunks; exactly one finish. */
export async function* translate(
  events: AsyncIterable<Record<string, unknown>>, model: string,
): AsyncGenerator<StreamChunk> {
  const blocks = new Map<number, Block>()
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  let started = false
  let reason: FinishReason | undefined
  for await (const event of events) {
    if (event.type === 'message_start') {
      if (started) malformed('duplicate message_start')
      updateUsage(usage, object(event.message).usage)
      started = true
      continue
    }
    if (event.type === 'error') {
      const fields = object(event.error)
      throw new LlmError(
        `zcode-glm: ${string(fields.message ?? 'provider stream error')}`,
        typeof fields.code === 'string' ? fields.code.toUpperCase() : 'PROVIDER_ERROR',
      )
    }
    if (!['content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'].includes(String(event.type))) {
      continue
    }
    if (!started) malformed('event precedes message_start')
    if (event.type === 'content_block_start') {
      const wireIndex = indexOf(event)
      if (blocks.has(wireIndex) || reason !== undefined) malformed('block starts after settlement or repeats an index')
      const block = startBlock(event, blocks.size)
      blocks.set(wireIndex, block)
      yield { type: 'block-start', index: block.index, blockType: block.content.type }
      if (block.content.type === 'text' || block.content.type === 'reasoning') {
        if (block.content.text) {
          yield { type: block.content.type === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text: block.content.text }
        }
      } else {
        yield { type: 'tool-call-delta', index: block.index, id: block.content.id, name: block.content.name, argumentsDelta: '' }
      }
    } else if (event.type === 'content_block_delta' || event.type === 'content_block_stop') {
      const block = blocks.get(indexOf(event))
      if (block === undefined || block.closed) malformed('delta/stop without an open block')
      if (event.type === 'content_block_delta') {
        const chunk = deltaChunk(block, event.delta)
        if (chunk !== undefined) yield chunk
      } else {
        block.closed = true
        if (block.content.type === 'tool-call' && block.json.length > 0) block.content.arguments = block.json
        yield { type: 'block-end', index: block.index, block: { ...block.content } }
      }
    } else if (event.type === 'message_delta') {
      const delta = object(event.delta)
      // GLM compat layers may send an explicit null stop_reason for a normal end.
      if ('stop_reason' in delta) reason = stopReason(delta.stop_reason)
      if (event.usage !== undefined) updateUsage(usage, event.usage)
    } else {
      if (reason === undefined) reason = { kind: 'stop' }
      if (blocks.size === 0 && reason.kind === 'stop') {
        throw new LlmError('zcode-glm: Messages returned no content', 'EMPTY_RESPONSE')
      }
      if (reason.kind !== 'max-tokens') {
        for (const { content } of blocks.values()) {
          if (content.type !== 'tool-call') continue
          if (content.arguments.length === 0) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(content.arguments)
          } catch {
            return malformed('tool input is invalid JSON')
          }
          object(parsed)
        }
      }
      usage.totalTokens = usage.inputTokens + usage.outputTokens +
        (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      yield { type: 'usage', usage }
      yield {
        type: 'finish',
        reason,
        replayState: {
          response: { model },
          blocks: [...blocks.values()].map(block =>
            block.content.type === 'reasoning' && block.signature ? block.signature : null,
          ),
        },
      }
      return
    }
  }
  throw new LlmError('zcode-glm: Messages stream ended before message_stop', 'STREAM_CLOSED')
}
