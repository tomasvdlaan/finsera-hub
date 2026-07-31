/**
 * Server-sent events, read off a POST.
 *
 * `EventSource` would do this for free and cannot be used: it only issues GETs, and the
 * question carries a conversation id and a context object that have no business in a URL. So
 * the framing is parsed by hand — which is a dozen lines, because SSE framing is a dozen
 * lines.
 *
 * The part worth writing carefully is the buffer. A chunk boundary falls wherever TCP decides,
 * routinely mid-JSON and occasionally mid-character; anything that parses per chunk works in
 * development against localhost and fails in production against a real network. So bytes are
 * decoded with `stream: true` and held until a blank line proves an event is whole.
 */
export async function* readEventStream<T>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Releasing the lock is not enough — an abandoned reader leaves the response open, and the
  // server keeps generating into it. Cancelling is what tells it to stop.
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', stop, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // `stream: true` keeps a multi-byte character split across chunks intact.
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame<T>(frame);
        if (parsed !== undefined) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}

/**
 * One frame into one value, or nothing.
 *
 * Comments (`:` lines) and unparseable payloads are skipped rather than thrown: a keep-alive
 * arriving between two real events must not end the stream, and neither should one malformed
 * frame throw away the answer either side of it.
 */
function parseFrame<T>(frame: string): T | undefined {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) return undefined;
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}
