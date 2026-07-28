import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  private handlers = new Map<string, (raw: Buffer) => void>();
  closed = false;
  on(event: string, handler: (raw: Buffer) => void) {
    this.handlers.set(event, handler);
  }
  close() {
    this.closed = true;
  }
  async deliver(raw: Buffer) {
    this.handlers.get('message')?.(raw);
    await new Promise((r) => setTimeout(r, 20));
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

  beforeEach(() => {
    segments = [];
    speakerEvents = [];
    const events: CaptureEvents = {
      onReady: vi.fn(),
      onSpeaker: (speaker, event) => speakerEvents.push({ speaker, event }),
      onSegment: (segment) => void segments.push(segment),
      onError: vi.fn(),
      onEnded: vi.fn(),
    };
    session = new RecallSession('bot-1', 'key', 'https://eu-central-1.recall.ai', events, new Logger('test'));
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
