import { describe, expect, it } from 'vitest';
import { readEventStream } from './sse.js';

/** A response body that hands out exactly the chunks given, byte for byte. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

const drain = async <T>(chunks: string[]): Promise<T[]> => {
  const out: T[] = [];
  for await (const e of readEventStream<T>(bodyOf(chunks))) out.push(e);
  return out;
};

/**
 * The framing.
 *
 * Every case here is a chunk boundary falling somewhere inconvenient, because that is the
 * entire risk: a parser that assumes one chunk is one event works perfectly against
 * localhost and fails against a real network, which is the worst possible place to find out.
 */
describe('readEventStream', () => {
  it('reads whole events', async () => {
    const events = await drain<{ type: string }>([
      'data: {"type":"tool","toolName":"crm_search_clients"}\n\n',
      'data: {"type":"text","delta":"Two"}\n\n',
    ]);
    expect(events).toEqual([
      { type: 'tool', toolName: 'crm_search_clients' },
      { type: 'text', delta: 'Two' },
    ]);
  });

  it('joins an event split across chunks', async () => {
    const events = await drain<{ delta: string }>(['data: {"type":"text","de', 'lta":"hi"}\n\n']);
    expect(events).toEqual([{ type: 'text', delta: 'hi' }]);
  });

  it('splits several events arriving in one chunk', async () => {
    const events = await drain<{ delta: string }>([
      'data: {"delta":"a"}\n\ndata: {"delta":"b"}\n\ndata: {"delta":"c"}\n\n',
    ]);
    expect(events.map((e) => e.delta)).toEqual(['a', 'b', 'c']);
  });

  it('survives a boundary landing inside the frame separator', async () => {
    const events = await drain<{ delta: string }>(['data: {"delta":"a"}\n', '\ndata: {"delta":"b"}\n\n']);
    expect(events.map((e) => e.delta)).toEqual(['a', 'b']);
  });

  it('keeps a multi-byte character split across chunks intact', async () => {
    // "€" is three bytes; decoding per chunk without `stream: true` yields a replacement
    // character, and the answer silently gains a "" nobody can explain.
    const bytes = new TextEncoder().encode('data: {"delta":"€1.400"}\n\n');
    const events: Array<{ delta: string }> = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 18));
        controller.enqueue(bytes.slice(18));
        controller.close();
      },
    });
    for await (const e of readEventStream<{ delta: string }>(body)) events.push(e);
    expect(events).toEqual([{ delta: '€1.400' }]);
  });

  it('ignores keep-alive comments', async () => {
    const events = await drain<{ delta: string }>([': keep-alive\n\n', 'data: {"delta":"a"}\n\n']);
    expect(events).toEqual([{ delta: 'a' }]);
  });

  it('skips one malformed frame rather than losing the stream', async () => {
    const events = await drain<{ delta: string }>([
      'data: {"delta":"a"}\n\n',
      'data: {not json}\n\n',
      'data: {"delta":"b"}\n\n',
    ]);
    expect(events.map((e) => e.delta)).toEqual(['a', 'b']);
  });

  it('drops a trailing frame that never got its blank line', async () => {
    // Deliberate: an unterminated frame is a truncated one, and half a JSON object parsed
    // optimistically is how a stream invents content that was never sent.
    const events = await drain<{ delta: string }>(['data: {"delta":"a"}\n\ndata: {"delta":"b"']);
    expect(events.map((e) => e.delta)).toEqual(['a']);
  });

  it('stops when the caller aborts', async () => {
    const abort = new AbortController();
    const body = bodyOf(['data: {"delta":"a"}\n\n', 'data: {"delta":"b"}\n\n']);
    const seen: Array<{ delta: string }> = [];
    for await (const e of readEventStream<{ delta: string }>(body, abort.signal)) {
      seen.push(e);
      abort.abort();
    }
    expect(seen.map((s) => s.delta)).toEqual(['a']);
  });
});
