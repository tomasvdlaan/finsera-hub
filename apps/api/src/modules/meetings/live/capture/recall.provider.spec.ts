import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { SAMPLE_RATE } from './vad.js';
import { RecallProvider, RecallSession } from './recall.provider.js';
import type { AudioSegment, CaptureEvents, Speaker } from './provider.js';

const tone = (ms: number, amplitude = 0.3) => {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 180 * i) / SAMPLE_RATE) * amplitude * 32_767), i * 2);
  }
  return buf;
};
const silence = (ms: number) => Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * 2);

/** A message shaped as Recall sends it. */
const audioFrom = (id: string, name: string, pcm: Buffer) =>
  Buffer.from(
    JSON.stringify({
      event: 'audio_separate_raw.data',
      data: { data: { buffer: pcm.toString('base64'), participant: { id, name } } },
    }),
  );

const participantEvent = (event: string, id: string, name: string) =>
  Buffer.from(JSON.stringify({ event, data: { participant: { id, name } } }));

class FakeSocket {
  private handlers = new Map<string, (raw: Buffer) => unknown>();
  closed = false;
  pings = 0;
  readonly OPEN = 1;
  readyState = 1;
  on(event: string, handler: (raw: Buffer) => unknown) {
    this.handlers.set(event, handler);
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  ping() {
    this.pings++;
  }
  close() {
    this.closed = true;
  }
  /** Fire the close handler, as `ws` does when the connection actually goes. */
  fireClose() {
    this.handlers.get('close')?.(Buffer.alloc(0));
  }
  /** Deliver, and wait for it to be handled — the provider returns the handler's promise. */
  async deliver(raw: Buffer) {
    await this.handlers.get('message')?.(raw);
  }
}

describe('RecallProvider', () => {
  it('refuses to run without an API key', () => {
    const previous = process.env.RECALL_API_KEY;
    delete process.env.RECALL_API_KEY;
    expect(new RecallProvider().isConfigured()).toBe(false);
    if (previous) process.env.RECALL_API_KEY = previous;
  });

  it('declares that attribution comes from the transport', () => {
    // This is the property the whole provider was chosen for.
    expect(new RecallProvider().hasPerSpeakerAudio).toBe(true);
  });
});

describe('RecallSession', () => {
  let segments: AudioSegment[];
  let speakerEvents: Array<{ speaker: Speaker; event: string }>;
  let session: RecallSession;
  let socket: FakeSocket;
  let ended: string[];

  beforeEach(() => {
    segments = [];
    speakerEvents = [];
    ended = [];
    const events: CaptureEvents = {
      onReady: vi.fn(),
      onSpeaker: (speaker, event) => speakerEvents.push({ speaker, event }),
      onSegment: (segment) => void segments.push(segment),
      onError: vi.fn(),
      onEnded: (reason) => void ended.push(reason),
    };
    session = new RecallSession('bot-1', 'key', 'https://eu-central-1.recall.ai', events, new Logger('test'), 'secret-token');
    socket = new FakeSocket();
    session.attach(socket as never);
  });

  /** Speak, then pause, which is what closes an utterance. */
  const say = async (id: string, name: string, ms = 1_000) => {
    for (let i = 0; i < ms / 100; i++) await socket.deliver(audioFrom(id, name, tone(100)));
    await socket.deliver(audioFrom(id, name, silence(300)));
    await socket.deliver(audioFrom(id, name, silence(400)));
  };

  it('attributes speech to the person who said it, by name', async () => {
    await say('7', 'Marieke');

    expect(segments).toHaveLength(1);
    expect(segments[0]!.speaker.name).toBe('Marieke');
    expect(segments[0]!.speaker.id).toBe('7');
    expect(segments[0]!.mimeType).toBe('audio/wav');
    expect(segments[0]!.data.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('keeps two people talking at once apart, which is the whole point', async () => {
    // Interleaved frames, as concurrent speech arrives on separate streams.
    for (let i = 0; i < 10; i++) {
      await socket.deliver(audioFrom('7', 'Marieke', tone(100)));
      await socket.deliver(audioFrom('9', 'Jan', tone(100)));
    }
    for (const [id, name] of [['7', 'Marieke'], ['9', 'Jan']] as const) {
      await socket.deliver(audioFrom(id, name, silence(300)));
      await socket.deliver(audioFrom(id, name, silence(400)));
    }

    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.speaker.name).sort()).toEqual(['Jan', 'Marieke']);
    // No mixed stream, so no chance of one person's words landing on the other.
  });

  it('spends nothing on a participant who never speaks', async () => {
    for (let i = 0; i < 30; i++) await socket.deliver(audioFrom('9', 'Silent Jan', silence(100)));
    expect(segments).toHaveLength(0);
  });

  it('ignores its own voice while speaking', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const speaking = session.speak(Buffer.from('fake mp3'), 'audio/mp3');
    expect(session.isSpeaking()).toBe(true);

    // Audio arriving while the bot talks is its own voice coming back on the mix.
    await say('7', 'Marieke');
    expect(segments).toHaveLength(0);

    await speaking;
    vi.unstubAllGlobals();
  });

  it('reports people joining and leaving', async () => {
    await socket.deliver(participantEvent('participant_events.join', '7', 'Marieke'));
    await socket.deliver(participantEvent('participant_events.leave', '7', 'Marieke'));
    expect(speakerEvents.map((e) => e.event)).toEqual(['joined', 'left']);
  });

  it('keeps a sentence someone was mid-way through when they left', async () => {
    for (let i = 0; i < 10; i++) await socket.deliver(audioFrom('7', 'Marieke', tone(100)));
    expect(segments).toHaveLength(0); // still held, no pause yet

    await socket.deliver(participantEvent('participant_events.leave', '7', 'Marieke'));
    expect(segments).toHaveLength(1);
  });

  it('takes the newest display name without losing identity', async () => {
    await say('7', 'iPhone');
    await say('7', 'Marieke de Vries');
    expect(segments.map((s) => s.speaker.id)).toEqual(['7', '7']);
    expect(segments[1]!.speaker.name).toBe('Marieke de Vries');
  });

  it('refuses audio Recall will not accept', async () => {
    await expect(session.speak(Buffer.from('x'), 'audio/wav')).rejects.toThrow(/MP3/);
  });

  it('survives a malformed message', async () => {
    await socket.deliver(Buffer.from('not json at all'));
    await say('7', 'Marieke');
    expect(segments).toHaveLength(1);
  });
});

/**
 * The stream dropping is not the meeting ending.
 *
 * This cost three real recordings in one afternoon. Recall's realtime websocket closes and
 * reopens — on a live meeting it did so roughly every eight minutes, our side hanging up
 * without a TLS close_notify — and every close was treated as the end: the session was torn
 * down, the note written, and `leave_call` posted to a bot still sitting in the meeting. In
 * Recall's own log the reconnect succeeds at 15:11:12 and the eviction follows at 15:11:13.
 */
describe('RecallSession when the stream drops', () => {
  let ended: string[];
  let session: RecallSession;
  let socket: FakeSocket;

  const events = (): CaptureEvents => ({
    onReady: vi.fn(),
    onSpeaker: vi.fn(),
    onSegment: vi.fn(),
    onError: vi.fn(),
    onEnded: (reason: string) => void ended.push(reason),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    ended = [];
    session = new RecallSession('bot-1', 'key', 'https://x', events(), new Logger('test'), 'tok');
    socket = new FakeSocket();
    session.attach(socket as never);
  });

  afterEach(() => vi.useRealTimers());

  it('does not end the meeting the moment the stream goes', () => {
    socket.fireClose();
    // Recall reconnected within eight seconds every time it was seen doing this.
    vi.advanceTimersByTime(10_000);
    expect(ended).toEqual([]);
  });

  it('carries on when the stream comes back inside the window', () => {
    socket.fireClose();
    vi.advanceTimersByTime(10_000);

    const replacement = new FakeSocket();
    session.attach(replacement as never);

    // Well past the grace period: the reconnect cancelled it, so nothing ends.
    vi.advanceTimersByTime(120_000);
    expect(ended).toEqual([]);
  });

  it('ignores a dead socket closing after its replacement arrived', () => {
    /*
     * The exact bug. `close` fires late, so the old socket's handler ran after the new one had
     * attached and ended a meeting that was working perfectly.
     */
    const replacement = new FakeSocket();
    session.attach(replacement as never);

    socket.fireClose();
    vi.advanceTimersByTime(120_000);

    expect(ended).toEqual([]);
  });

  it('ends the meeting when the stream never comes back', () => {
    socket.fireClose();
    vi.advanceTimersByTime(61_000);

    expect(ended).toHaveLength(1);
    // Says what happened, rather than "the bot disconnected" for every possible cause.
    expect(ended[0]).toMatch(/did not come back/i);
  });

  it('pings, so a quiet meeting does not look like an idle connection', () => {
    vi.advanceTimersByTime(95_000);
    expect(socket.pings).toBeGreaterThanOrEqual(3);
  });

  it('stops pinging once the stream is gone', () => {
    socket.fireClose();
    const before = socket.pings;
    vi.advanceTimersByTime(95_000);
    expect(socket.pings).toBe(before);
  });
});
