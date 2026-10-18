/**
 * Serialize harness-neutral requests into the GLM Anthropic Messages wire
 * format. Tool history replays native thinking signatures when present.
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { GlmModelEntry } from './models.ts'

export interface WireBlock { type: string; [field: string]: unknown }
export interface WireMessage { role: 'user' | 'assistant' | 'system'; content: WireBlock[] }
export interface WireRequest {
  model: string
  stream: true
  messages: WireMessage[]
  max_tokens: number
  thinking: { type: 'enabled' } | { type: 'disabled' }
  [field: string]: unknown
}

/**
 * Reasoning effort → official `output_config.effort` value. The official
 * client sends the level itself on the wire (`thinking:{type:"enabled"}`
 * without a budget, plus `output_config:{effort:"low"|"medium"|"high"|
 * "xhigh"|"max"}`), so levels ride on output_config, never on
 * budget_tokens. dsh's `minimal` has no official slot and lands on `low`.
 */
const WIRE_EFFORTS: Record<string, string> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** Signatures recovered from a previous response, keyed by assistant turn + block index. */
export interface ReplaySignatures {
  /** One entry per emitted reasoning block, in finish order. */
  signatures: string[]
}

function unsupported(type: string): never {
  throw new LlmError(`zcode-glm: Anthropic Messages cannot represent ${type}`, 'UNSUPPORTED_CONTENT')
}

function toolInput(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Serialize one request. System text lands in the top-level `system` slot;
 * developer notes become in-history system turns; tool results become
 * `tool_result` blocks on the following user turn.
 */
export function serialize(
  options: GenerateOptions,
  defaults: {
    models: readonly GlmModelEntry[]
    defaultMaxTokens: number
    defaultEffort?: string
    thinkingDisabled?: boolean
  },
  replayByMessage?: ReadonlyMap<Message, ReplaySignatures>,
): WireRequest {
  const model = defaults.models.find(entry => entry.id === options.model)
  const messages: WireMessage[] = []
  let historySystem: string | undefined
  const pendingSystem: WireMessage[] = []
  const flushSystem = () => {
    if (pendingSystem.length === 0) return
    if (messages.at(-1)?.role !== 'user') return
    messages.push(...pendingSystem.splice(0))
  }

  for (const message of options.messages) {
    if (message.role === 'developer') {
      // Defensive only: LlmRuntime strips developer messages for routes that
      // declare no systemPromptUpdate/toolUpdate capability (this one); if a
      // developer note ever reaches here anyway, project its text as an
      // in-history system turn rather than failing the request.
      const text = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (text.length > 0) {
        messages.push({ role: 'system', content: [{ type: 'text', text }] })
      }
      continue
    }
    if (message.role === 'system') {
      const texts = message.content.filter(block => block.type === 'text')
      const text = texts.map(block => block.text).join('')
      if (messages.length > 0 && text.length > 0) {
        messages.push({ role: 'system', content: [{ type: 'text', text }] })
      } else {
        historySystem = text
      }
      continue
    }
    const content: WireBlock[] = message.role === 'assistant'
      ? assistantBlocks(message, options.model, replayByMessage?.get(message))
      : message.role === 'tool'
        ? [{
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content.flatMap(block =>
              block.type === 'text' && block.text ? [{ type: 'text', text: block.text }] : [],
            ),
            ...(message.isError === undefined ? {} : { is_error: message.isError }),
          }]
        : message.content.flatMap(block => {
            if (block.type === 'text') {
              return block.text ? [{ type: 'text', text: block.text }] : []
            }
            if (block.type === 'file' || block.type === 'image') {
              return unsupported(`user content ${block.type} (text-only route)`)
            }
            return []
          })
    if ((message.role === 'user' || message.role === 'assistant') && content.length === 0) continue
    if (message.role === 'assistant') flushSystem()
    const wireRole: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user'
    const previous = messages.at(-1)
    if (previous?.role === wireRole) previous.content.push(...content)
    else messages.push({ role: wireRole, content })
  }
  flushSystem()

  // Tool results must directly follow their calls; validate pairings.
  let pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      pending = new Set(message.content.filter(block => block.type === 'tool_use').map(block => String(block.id)))
    } else if (message.role === 'user') {
      const results = message.content.filter(block => block.type === 'tool_result')
      const rest = message.content.filter(block => block.type !== 'tool_result')
      for (const result of results) pending.delete(String(result.tool_use_id))
      message.content = [...results, ...rest]
    }
  }
  if (pending.size > 0) {
    throw new LlmError('zcode-glm: history ends with unresolved tool calls', 'INVALID_REQUEST')
  }

  const effort = options.reasoningEffort ?? defaults.defaultEffort ?? 'high'
  const thinkingOn = model?.thinking !== false && !defaults.thinkingDisabled && effort !== 'off'
  const wireEffort = WIRE_EFFORTS[effort] ?? 'high'
  const system = [options.system, historySystem].filter(Boolean).join('\n\n')
  return {
    model: options.model,
    stream: true,
    messages,
    max_tokens: options.maxTokens ?? model?.maxTokens ?? defaults.defaultMaxTokens,
    thinking: thinkingOn ? { type: 'enabled' } : { type: 'disabled' },
    ...(thinkingOn ? { output_config: { effort: wireEffort } } : {}),
    ...(system.length === 0 ? {} : { system }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.stop === undefined ? {} : { stop_sequences: options.stop }),
    ...(options.tools === undefined || options.tools.length === 0 ? {} : {
      tools: options.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    }),
  }
}

function assistantBlocks(
  message: Message, model: string, replay?: ReplaySignatures,
): WireBlock[] {
  let reasoningIndex = -1
  return message.content.flatMap((block): WireBlock[] => {
    switch (block.type) {
      case 'text':
        return block.text.length === 0 ? [] : [{ type: 'text', text: block.text }]
      case 'reasoning': {
        reasoningIndex += 1
        const signature = replay?.signatures[reasoningIndex]
        return [{
          type: 'thinking',
          thinking: block.text,
          ...(signature ? { signature } : {}),
        }]
      }
      case 'tool-call':
        return [{ type: 'tool_use', id: block.id, name: block.name, input: toolInput(block.arguments) }]
      default:
        return unsupported(`assistant content ${block.type}`)
    }
  })
}
