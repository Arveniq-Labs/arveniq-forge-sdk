import type { ForgeChatEvent, ForgeChatState } from './types.js';

export class ForgeStreamError extends Error {
  constructor(
    message: string,
    public readonly code = 'stream_interrupted',
  ) {
    super(message);
    this.name = 'ForgeStreamError';
  }
}

/** Parse SSE independently of network chunk boundaries, including CR/LF and UTF-8 splits. */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ForgeChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines: string[] = [];
  let frameBytes = 0;
  let pendingCr = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return; // An unterminated frame is not a dispatched SSE event.
      buffer += decoder.decode(chunk.value, { stream: true });
      if (pendingCr && buffer.length) {
        if (buffer.startsWith('\n')) buffer = buffer.slice(1);
        pendingCr = false;
      }
      let match: RegExpExecArray | null;
      while ((match = /[\r\n]/.exec(buffer))) {
        const line = buffer.slice(0, match.index);
        const separator = buffer[match.index];
        buffer = buffer.slice(match.index + 1);
        if (separator === '\r') {
          if (buffer.startsWith('\n')) buffer = buffer.slice(1);
          else if (!buffer.length) pendingCr = true;
        }
        frameBytes += line.length;
        if (frameBytes > 2_000_000)
          throw new ForgeStreamError(
            'SSE event exceeds the supported size.',
            'stream_event_too_large',
          );
        if (line !== '') {
          lines.push(line);
          continue;
        }
        const data = lines
          .filter((value) => value.startsWith('data:'))
          .map((value) => value.slice(5).replace(/^ /, ''))
          .join('\n');
        lines = [];
        frameBytes = 0;
        if (!data) continue;
        let event: ForgeChatEvent & { code?: string; message?: string };
        try {
          event = JSON.parse(data);
        } catch {
          throw new ForgeStreamError('Invalid SSE JSON.', 'stream_event_invalid');
        }
        if ((event.type as string) === 'error')
          throw new ForgeStreamError(event.message ?? 'Forge stream interrupted.', event.code);
        if (
          event.version !== 1 ||
          typeof event.turnId !== 'string' ||
          typeof event.type !== 'string' ||
          !event.data
        ) {
          throw new ForgeStreamError('Invalid Forge chat event.', 'stream_event_invalid');
        }
        yield event;
      }
      if (buffer.length + frameBytes > 2_000_000)
        throw new ForgeStreamError(
          'SSE event exceeds the supported size.',
          'stream_event_too_large',
        );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Produces complete display text; replacement and replay never duplicate answer chunks. */
export function reduceChatEvent(state: ForgeChatState, event: ForgeChatEvent): ForgeChatState {
  const previous = state.turnId && state.turnId !== event.turnId ? { text: '' } : state;
  if (
    event.sequence &&
    previous.lastSequence &&
    BigInt(event.sequence) <= BigInt(previous.lastSequence)
  )
    return previous;
  const next = {
    ...previous,
    turnId: event.turnId,
    ...(event.eventId ? { lastEventId: event.eventId } : {}),
    ...(event.sequence ? { lastSequence: event.sequence } : {}),
  };
  if (event.type === 'activity.updated') next.activity = event.data.message;
  if (event.type === 'response.started' && event.data.replace) next.text = '';
  if (event.type === 'response.delta')
    next.text = event.data.replace
      ? (event.data.delta ?? '')
      : next.text + (event.data.delta ?? '');
  if (event.type === 'response.completed') next.text = event.data.text ?? next.text;
  if (event.data.status) next.status = event.data.status;
  if (event.type.startsWith('response.') || isChatTurnSettled(event)) next.activity = undefined;
  return next;
}

export function isChatTurnSettled(event: ForgeChatEvent) {
  return ['turn.completed', 'turn.failed', 'turn.canceled', 'turn.requires_action'].includes(
    event.type,
  );
}
