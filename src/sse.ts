/** SSE framing via eventsource-parser; JSON errors are provider failures. */

import { EventSourceParserStream } from 'eventsource-parser/stream'

/** Decode complete SSE frames; an unterminated tail is not an event. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>, activity: () => void,
): AsyncGenerator<Record<string, unknown>> {
  // The DOM lib's TextDecoderStream generics clash with Node stream types;
  // a TransformStream with the same semantics keeps the types aligned.
  const decoder = new TextDecoder()
  const decoded = body.pipeThrough(new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(chunk, { stream: true }))
    },
    flush(controller) {
      const tail = decoder.decode()
      if (tail) controller.enqueue(tail)
    },
  }))
  const events = decoded.pipeThrough(new EventSourceParserStream({ onComment: activity }))
  for await (const frame of events) {
    activity()
    let raw: unknown
    try {
      raw = JSON.parse(frame.data)
    } catch {
      // Some gateway frames (keep-alive comments already filtered) can be
      // non-JSON; only data frames that fail to parse are fatal.
      throw new Error('zcode-glm: SSE contains invalid JSON')
    }
    if (typeof raw !== 'object' || raw === null) throw new Error('zcode-glm: SSE event is not an object')
    yield raw as Record<string, unknown>
  }
}
