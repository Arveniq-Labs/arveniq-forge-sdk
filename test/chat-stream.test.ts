import assert from 'node:assert/strict';
import test from 'node:test';
import { ForgeDeveloperClient, ForgeApiError } from '../src/client.js';
import { readChatEvents, reduceChatEvent } from '../src/chat-stream.js';
import type { ForgeChatEvent, ForgeChatState } from '../src/types.js';

function event(
  type: ForgeChatEvent['type'],
  data: ForgeChatEvent['data'] = {},
  sequence?: string,
): ForgeChatEvent {
  return {
    type,
    version: 1,
    conversationId: 'c1',
    turnId: 't1',
    messageId: 't1:assistant',
    createdAt: '2026-09-18T00:00:00Z',
    data,
    ...(sequence ? { sequence, eventId: `e${sequence}` } : {}),
  };
}
function sse(events: ForgeChatEvent[]) {
  return new Response(
    events
      .map((e) => `id: ${e.eventId ?? ''}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
function client(fetcher: typeof fetch) {
  return new ForgeDeveloperClient({
    baseUrl: 'https://forge-os.io/v1',
    apiKey: 'test-key',
    fetcher,
  });
}

test('SSE parser handles single-byte UTF-8, CRLF, comments and multiline data', async () => {
  const expected = event('response.delta', { delta: 'Hello 🌏' }, '1');
  const source =
    ': heartbeat\r\n\r\ndata: ' +
    JSON.stringify(expected, null, 2).split('\n').join('\r\ndata: ') +
    '\r\n\r\n';
  const bytes = new TextEncoder().encode(source);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  assert.deepEqual(await Array.fromAsync(readChatEvents(body)), [expected]);
});

test('SDK reconnects the accepted turn with cursor and deduplicates replay without polling', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const forge = client(async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? sse([event('turn.accepted'), event('response.delta', { delta: 'Hello' }, '1')])
      : sse([
          event('response.delta', { delta: 'Hello' }, '1'),
          event('response.delta', { delta: ' world' }, '2'),
          event('response.completed', { text: 'Hello world!' }),
          event('turn.completed', { status: 'completed' }),
        ]);
  });
  let state: ForgeChatState = { text: '' };
  for await (const e of forge.streamMessage(
    'c1',
    { clientMessageId: 'm1', message: 'hi' },
    { reconnectDelayMs: 1 },
  ))
    state = reduceChatEvent(state, e);
  assert.equal(state.text, 'Hello world!');
  assert.equal(state.status, 'completed');
  assert.match(requests[1]!.url, /\/turns\/t1\/events\/stream$/);
  assert.equal(new Headers(requests[1]!.init?.headers).get('last-event-id'), 'e1');
  for (const request of requests)
    assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer test-key');
  assert.equal(requests.length, 2);
});

test('lost initial response retries the same clientMessageId and body', async () => {
  const bodies: unknown[] = [];
  const forge = client(async (_url, init) => {
    bodies.push(init?.body);
    if (bodies.length === 1) throw new TypeError('network');
    return sse([event('turn.accepted'), event('turn.completed')]);
  });
  await Array.fromAsync(
    forge.streamMessage(
      'c1',
      { clientMessageId: 'stable', message: 'hello' },
      { reconnectDelayMs: 1 },
    ),
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test('replacement, replay and new turns assemble correct chat state', () => {
  let state = reduceChatEvent({ text: '' }, event('response.delta', { delta: 'draft' }, '1'));
  state = reduceChatEvent(state, event('response.started', { replace: true }, '2'));
  state = reduceChatEvent(state, event('response.delta', { delta: 'answer' }, '3'));
  state = reduceChatEvent(state, event('response.delta', { delta: 'answer' }, '3'));
  assert.equal(state.text, 'answer');
  state = reduceChatEvent(state, { ...event('turn.accepted'), turnId: 't2' });
  assert.equal(state.text, '');
});

test('permission errors are not retried and approval is a resumable pause', async () => {
  let calls = 0;
  const denied = client(async () => {
    calls++;
    return new Response('forbidden', { status: 403 });
  });
  await assert.rejects(
    async () => Array.fromAsync(denied.streamConversationTurn('c1', 't1')),
    ForgeApiError,
  );
  assert.equal(calls, 1);
  const paused = client(async () =>
    sse([event('turn.requires_action', { status: 'approval_required' })]),
  );
  assert.equal(
    (await Array.fromAsync(paused.streamConversationTurn('c1', 't1'))).at(-1)?.type,
    'turn.requires_action',
  );
});

test('abort interrupts reconnect backoff and truncated events do not become text', async () => {
  const controller = new AbortController();
  const forge = client(async () => {
    controller.abort();
    throw new TypeError('network');
  });
  await assert.rejects(
    async () =>
      Array.fromAsync(forge.streamConversationTurn('c1', 't1', { signal: controller.signal })),
    { name: 'AbortError' },
  );
  const incomplete = new Response('data: {"type":"response.delta"}');
  assert.deepEqual(await Array.fromAsync(readChatEvents(incomplete.body!)), []);
});
