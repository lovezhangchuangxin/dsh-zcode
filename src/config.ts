/** Plugin configuration resolved once per generation. */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_MODELS } from './models.ts'

export interface Config {
  baseURL: string
  /** App version reported in source headers and at PAT issuance. */
  appVersion: string
  /** Stable device identity; regenerated per profile when left empty. */
  deviceMid: string
  models: unknown
  defaultEffort: string
  defaultMaxTokens: number
  streamIdleTimeoutMs: number
}

export const Config = z.object({
  // Anthropic-SDK convention: the base ends at /v1 and the adapter appends
  // /messages. GLM's compatible endpoint is /api/anthropic/v1/messages.
  baseURL: z.string().default('https://open.bigmodel.cn/api/anthropic/v1'),
  appVersion: z.string().default('3.15.1'),
  deviceMid: z.string().default(''),
  models: z.any().default([...DEFAULT_MODELS]),
  defaultEffort: z.string().default('high'),
  defaultMaxTokens: z.number().default(131_072),
  streamIdleTimeoutMs: z.number().default(120_000),
})
