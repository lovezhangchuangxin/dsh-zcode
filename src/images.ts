/**
 * GLM Coding Plan request images. The harness attachment pipeline hands the
 * adapter durable references only; this module resolves them to request bytes
 * and enforces the inline budget, mirroring the reference DeepSeek adapter
 * (the GLM Anthropic endpoint has no Files API, so every image rides inline
 * base64 inside the JSON body).
 *
 * @module dsh-zcode/images
 */

import type { ImageAttachmentRef, ImageRequestTarget, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  contentHasImage, IMAGE_OFFLOAD_REQUIRED_CODE, LlmError, offloadedImageText, projectOffloadedImages, requiredImageOffload,
} from '@deepseek-ai/dsh-llm'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'

/** Read-only execution-world path for one attachment, when bridgeable. */
export interface ImageAccess {
  readonlyPath: string
}

/** The structural slice of the attachment service (`ctx.attachments`) this module needs. */
export interface AttachmentStoreLike {
  /** Resolve one durable reference to request bytes at the route's target. */
  readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal): Promise<RequestImageAttachment>
  /** Read-only host path of the normalized copy, when the store exposes one. */
  imageHostPath?(ref: ImageAttachmentRef): string | undefined
}

/**
 * Per-image encoded-byte target: base64 of 3.5 MiB stays under the 5 MB per
 * image the Anthropic wire convention caps, so the local store re-encodes
 * anything larger while targets above the source keep the source untouched.
 */
export const PER_IMAGE_MAX_BYTES = 3_500_000

/** Inline budget the whole request must fit; excess oldest occurrences offload. */
const IMAGE_REQUEST_BUDGET = {
  representation: 'base64' as const,
  maxBytes: 16 * 1024 * 1024,
  maxImages: 10,
}

/** Request images keyed by durable attachment identity, as serialize consumes them. */
export type RequestImageVersions = ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>

/**
 * Normalize retained image references before serializing Messages content.
 * @param input - history, the route's vision capability, the attachment store,
 *   the per-image target resolver (the adapter's `imageRequestTarget`), and
 *   the request's cancellation signal.
 * @returns projected history and prepared image bytes keyed by attachment id.
 * @throws LlmError `UNSUPPORTED_CONTENT` when the route or host cannot carry
 *   images, `IMAGE_OFFLOAD_REQUIRED` when the request exceeds the budget.
 */
export async function prepareImages(input: {
  history: readonly RequestMessage[]
  /** Whether the targeted model's input modalities include image. */
  supportsVision: boolean
  attachments: AttachmentStoreLike | undefined
  resolveTarget: (ref: ImageAttachmentRef) => ImageRequestTarget
  /** Bridge one attachment's host path into the tool execution world, for the model-visible handle texts. */
  resolveAccess?: (ref: ImageAttachmentRef) => ImageAccess | undefined
  signal: AbortSignal | undefined
}): Promise<{ messages: readonly RequestMessage[]; versions: RequestImageVersions }> {
  const versions = new Map<ImageAttachmentRef['attachmentId'], RequestImageAttachment>()
  const messages = projectOffloadedImages(input.history, ref => offloadedImageText(ref, input.resolveAccess?.(ref)))
  if (!messages.some(message => contentHasImage(message.content))) return { messages, versions }
  if (!input.supportsVision || input.attachments === undefined) {
    throw new LlmError('zcode-glm: image input requires a vision model and the attachment service', 'UNSUPPORTED_CONTENT')
  }
  if (messages.some(message => message.role !== 'user' && message.role !== 'tool' && contentHasImage(message.content))) {
    throw new LlmError('zcode-glm: images are supported only in user messages and tool results', 'UNSUPPORTED_CONTENT')
  }
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'image') continue
      const ref = block.attachment
      if (!versions.has(ref.attachmentId)) {
        versions.set(ref.attachmentId, await input.attachments.readImageRequest(ref, input.resolveTarget(ref), input.signal))
      }
    }
  }
  const offloadImages = requiredImageOffload(messages, IMAGE_REQUEST_BUDGET, block => {
    const version = versions.get(block.attachment.attachmentId)
    // prepareImages has resolved every retained reference above.
    if (version === undefined) throw new LlmError('zcode-glm: request image is missing', 'INVALID_REQUEST')
    return version.bytes
  })
  if (offloadImages > 0) {
    throw new LlmError(
      `zcode-glm: request images exceed the inline budget; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
      IMAGE_OFFLOAD_REQUIRED_CODE,
      { offloadImages },
    )
  }
  return { messages, versions }
}
