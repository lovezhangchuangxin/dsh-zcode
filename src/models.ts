/** GLM Coding Plan model catalog shipped by default; fully overridable in config. */

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export interface GlmModelEntry {
  id: string
  name: string
  description?: string
  contextWindow: number
  maxTokens: number
  /** Whether the model supports toggling thinking on and off. */
  thinking: boolean
}

/** Reasoning efforts in ascending order, per the harness vocabulary. */
export const GLM_REASONING_EFFORTS: readonly { id: ReturnType<typeof ReasoningEffortId>; name: string }[] = [
  { id: ReasoningEffortId('off'), name: 'Off' },
  { id: ReasoningEffortId('low'), name: 'Low' },
  { id: ReasoningEffortId('medium'), name: 'Medium' },
  { id: ReasoningEffortId('high'), name: 'High' },
]

export const DEFAULT_MODELS: readonly GlmModelEntry[] = [
  {
    id: 'GLM-5.3',
    name: 'GLM-5.3',
    description: 'Flagship GLM reasoning model on the Coding Plan.',
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    thinking: true,
  },
  {
    id: 'GLM-5.2',
    name: 'GLM-5.2',
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    thinking: true,
  },
  {
    id: 'GLM-5-Turbo',
    name: 'GLM-5-Turbo',
    description: 'Fast long-context GLM model.',
    contextWindow: 2_000_000,
    maxTokens: 128_000,
    thinking: true,
  },
]

/** Parse user-supplied model rows from config; fall back to the shipped catalog. */
export function resolveModels(raw: unknown): readonly GlmModelEntry[] {
  if (!Array.isArray(raw)) return DEFAULT_MODELS
  const parsed: GlmModelEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const fields = entry as Record<string, unknown>
    const id = typeof fields.id === 'string' ? fields.id.trim() : ''
    const contextWindow = Number(fields.contextWindow)
    const maxTokens = Number(fields.maxTokens)
    if (!id || !Number.isInteger(contextWindow) || contextWindow <= 0) continue
    parsed.push({
      id,
      name: typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : id,
      ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
      contextWindow,
      maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 128_000,
      thinking: fields.thinking !== false,
    })
  }
  return parsed.length > 0 ? parsed : DEFAULT_MODELS
}
