# Relaying Forge into an embedded chat

Keep the Forge SDK and API key on your server. The following Express-style handler
assumes your application supplies `requireSession`, `assertConversationOwner`, and
JSON body parsing. Map your user to a saved Forge conversation when creating it.
Never authorize a conversation using only an ID supplied by the browser.

```ts
app.post('/api/chat/:conversationId/messages', requireSession, async (req, res, next) => {
  const detached = new AbortController();
  res.on('close', () => detached.abort());
  try {
    await assertConversationOwner(req.user.id, req.params.conversationId);
    const events = forge.streamMessage(
      req.params.conversationId,
      {
        clientMessageId: req.body.clientMessageId,
        message: req.body.message,
      },
      { signal: detached.signal },
    );
    // Resolve the first event before committing HTTP headers so auth errors remain HTTP errors.
    const iterator = events[Symbol.asyncIterator]();
    let nextEvent = await iterator.next();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    try {
      while (!nextEvent.done && !detached.signal.aborted) {
        const event = nextEvent.value;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        nextEvent = await iterator.next();
      }
    } finally {
      await iterator.return?.();
    }
    res.end();
  } catch (error) {
    if (detached.signal.aborted) return;
    if (!res.headersSent) return next(error);
    res.write('event: error\ndata: {"type":"error","message":"Connection interrupted"}\n\n');
    res.end();
  }
});
```

Configure the application's proxy for streaming and bounded buffers; production
relays should wait for `drain` when `res.write()` returns false. Persist the
application message ID before the request. Retrying it after a browser disconnect
reuses the same Forge turn. For longer-lived views, relay the resume endpoint with
the last processed event ID instead.

The browser uses its own application session, not the Forge key. A React hook can
use `fetch` to read this endpoint and update one assistant message as events arrive.
The framework-independent `reduceChatEvent` helper is also exported from the
browser-safe `@arveniq/forge-sdk/chat` entry point. Treat received Markdown as
untrusted content and use your application's existing safe renderer.

```tsx
import { useRef, useState } from 'react';
import { readChatEvents, reduceChatEvent, type ForgeChatState } from '@arveniq/forge-sdk/chat';

export function useForgeChat(conversationId: string) {
  const [state, setState] = useState<ForgeChatState>({ text: '' });
  const controller = useRef<AbortController | null>(null);
  async function send(message: string, clientMessageId: string) {
    controller.current?.abort();
    const connection = new AbortController();
    controller.current = connection;
    setState({ text: '', status: 'connecting' });
    const response = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: connection.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, clientMessageId }),
    });
    if (!response.ok || !response.body) throw new Error('Unable to start chat');
    for await (const event of readChatEvents(response.body)) {
      setState((previous) => reduceChatEvent(previous, event));
    }
  }
  return { state, send, disconnect: () => controller.current?.abort() };
}
```

This minimal hook displays one turn and leaves transcript storage and error UI to
the host application. A Stop button should call an authenticated backend endpoint
that checks ownership and invokes `cancelConversationTurn`, then disconnect the
view. `disconnect` alone leaves the agent running.
