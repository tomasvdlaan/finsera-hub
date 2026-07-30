import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  elapsedSeconds,
  liveReducer,
  type LiveAction,
  type LiveState,
} from './liveMeetingReducer.js';

/**
 * The live meeting protocol.
 *
 * This is the only place in the web app where mishandling one message loses part of a real
 * meeting, so it is the one piece of front-end logic that earns tests outright. Every case
 * below is a way a client meeting record could come out wrong.
 */

const msg = (message: Record<string, unknown>): LiveAction => ({ type: 'message', message });
const line = (id: string, text: string, speaker?: string) => ({ id, at: 5, text, speaker });

const run = (actions: LiveAction[], from: LiveState = EMPTY) =>
  actions.reduce(liveReducer, from);

describe('liveReducer', () => {
  it('starts a session against the note it belongs to', () => {
    const state = run([{ type: 'starting', noteId: 'note-1', source: 'microphone' }]);
    expect(state.noteId).toBe('note-1');
    expect(state.source).toBe('microphone');
    expect(state.running).toBe(false); // not until the server says ready
  });

  it('does not carry one meeting’s words into the next', () => {
    const state = run([
      { type: 'starting', noteId: 'note-1', source: 'microphone' },
      msg({ type: 'ready' }),
      msg({ type: 'line', line: line('a', 'From the first meeting') }),
      { type: 'closed' },
      { type: 'starting', noteId: 'note-2', source: 'microphone' },
    ]);

    expect(state.lines).toHaveLength(0);
    expect(state.noteId).toBe('note-2');
  });

  it('keeps a line only once, however often it arrives', () => {
    const state = run([
      msg({ type: 'ready' }),
      msg({ type: 'line', line: line('a', 'Said once') }),
      msg({ type: 'line', line: line('a', 'Said once') }),
    ]);

    // A reconnect replays. A duplicated line in a client's meeting record is worse than a
    // missing one, so identity decides rather than arrival.
    expect(state.lines).toHaveLength(1);
  });

  it('keeps the speaker, which is what makes a transcript worth reading', () => {
    const state = run([msg({ type: 'line', line: line('a', 'We need drill-down', 'Anna') })]);
    expect(state.lines[0]!.speaker).toBe('Anna');
  });

  it('de-duplicates proposals across passes', () => {
    const p = { id: 'p1', kind: 'action' as const, text: 'Send the dataset' };
    const state = run([
      msg({ type: 'proposals', proposals: [p] }),
      msg({ type: 'proposals', proposals: [p, { ...p, id: 'p2', text: 'Book a review' }] }),
    ]);

    expect(state.proposals.map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  it('replaces the assistant’s notes rather than appending them', () => {
    const state = run([
      msg({ type: 'notes', markdown: '### First draft' }),
      msg({ type: 'notes', markdown: '### Revised' }),
    ]);

    // The note-taker owns its section and rewrites it wholesale; appending would show every
    // draft of the same paragraph.
    expect(state.aiNotes).toBe('### Revised');
  });

  it('keeps the decisions the extraction pass found', () => {
    const state = run([
      msg({
        type: 'state',
        state: { summary: 'Scoped the model', decisions: ['Go weekly'], openQuestions: ['Who?'] },
      }),
    ]);

    // Broadcast on every pass and, until the room, rendered nowhere in the app.
    expect(state.extraction?.decisions).toEqual(['Go weekly']);
    expect(state.extraction?.openQuestions).toEqual(['Who?']);
  });

  it('flags the note as stale when somebody joins', () => {
    const before = run([msg({ type: 'ready' })]);
    const after = liveReducer(before, msg({ type: 'attendees', attendees: [] }));

    // A counter rather than a callback, so this stays a pure function.
    expect(after.noteStaleAt).toBe(before.noteStaleAt + 1);
    expect(after.running).toBe(true); // nothing about the session itself changed
  });

  it('ends the session on stopped, keeping what it produced', () => {
    const state = run([
      msg({ type: 'ready' }),
      msg({ type: 'line', line: line('a', 'Something said') }),
      msg({ type: 'stopped', costCents: 12, lines: 1 }),
    ]);

    expect(state.running).toBe(false);
    expect(state.costCents).toBe(12);
    expect(state.noteStaleAt).toBe(1);
    // Clearing the transcript on stop would throw away the thing you just recorded.
    expect(state.lines).toHaveLength(1);
  });

  it('a closed socket stops the recording without clearing it', () => {
    const state = run([
      msg({ type: 'ready' }),
      msg({ type: 'line', line: line('a', 'Mid-sentence') }),
      { type: 'closed' },
    ]);

    expect(state.running).toBe(false);
    expect(state.lines).toHaveLength(1);
  });

  it('picks a running session back up, bot or browser', () => {
    const bot = liveReducer(EMPTY, {
      type: 'resumed',
      noteId: 'n',
      status: { running: true, provider: 'recall', lines: [line('a', 'Earlier')], costCents: 4 },
    });
    expect(bot.source).toBe('bot');
    expect(bot.running).toBe(true);
    expect(bot.lines).toHaveLength(1);

    const browser = liveReducer(EMPTY, {
      type: 'resumed',
      noteId: 'n',
      status: { running: true, provider: 'browser' },
    });
    expect(browser.source).toBe('microphone');
  });

  it('ignores a message it does not know', () => {
    // An older tab must not be broken by a newer server. The protocol comment in the gateway
    // already lists fewer types than the server sends.
    const before = run([msg({ type: 'ready' })]);
    expect(liveReducer(before, msg({ type: 'something_new', data: 1 }))).toBe(before);
  });

  it('ignores speaker events, which the transcript already shows', () => {
    const before = run([msg({ type: 'ready' })]);
    expect(liveReducer(before, msg({ type: 'speaker', speaker: 'Anna', event: 'joined' }))).toBe(
      before,
    );
  });

  it('does not treat a reconnected socket as having audio', () => {
    const state = run([
      { type: 'resumed', noteId: 'n', status: { running: true, awaitingAudio: true, source: 'microphone' } },
      { type: 'needsAudio' },
      msg({ type: 'ready', mode: 'source' }),
    ]);

    // `ready` means the server accepted the socket, not that this tab holds a microphone.
    // Clearing the flag here produced a room with a running clock, recording silence.
    expect(state.needsAudio).toBe(true);
    expect(state.running).toBe(true);
  });

  it('clears the warning only once audio is actually in hand', () => {
    const state = run([{ type: 'needsAudio' }, { type: 'audioOk' }]);
    expect(state.needsAudio).toBe(false);
  });

  it('starting a fresh capture is never in the unfed state', () => {
    const state = run([
      { type: 'needsAudio' },
      { type: 'starting', noteId: 'n', source: 'microphone' },
    ]);
    expect(state.needsAudio).toBe(false);
  });

  it('takes the source back from the status when resuming', () => {
    const state = liveReducer(EMPTY, {
      type: 'resumed',
      noteId: 'n',
      status: { running: true, provider: 'browser', source: 'tab', awaitingAudio: true },
    });

    // A shared tab can never be reacquired silently, so which kind it was decides whether the
    // reload heals itself or has to ask.
    expect(state.source).toBe('tab');
  });

  it('surfaces an error without ending the meeting', () => {
    const state = run([
      msg({ type: 'ready' }),
      msg({ type: 'error', message: 'A segment could not be transcribed' }),
    ]);

    // One failed segment loses a few seconds of speech; it must not read as the meeting
    // having stopped.
    expect(state.error).toMatch(/segment/);
    expect(state.running).toBe(true);
  });

  it('clears a stale error once the session is ready again', () => {
    const state = run([msg({ type: 'error', message: 'The live connection failed.' }), msg({ type: 'ready' })]);
    expect(state.error).toBeNull();
  });
});

describe('elapsedSeconds', () => {
  it('counts from the server’s clock, not the browser’s uptime', () => {
    const startedAt = '2026-07-30T09:00:00.000Z';
    const now = new Date('2026-07-30T09:08:14.000Z').getTime();
    expect(elapsedSeconds(startedAt, now)).toBe(494);
  });

  it('never goes negative when the clocks disagree', () => {
    const startedAt = '2026-07-30T09:00:05.000Z';
    const now = new Date('2026-07-30T09:00:00.000Z').getTime();
    expect(elapsedSeconds(startedAt, now)).toBe(0);
  });

  it('is zero before anything has started', () => {
    expect(elapsedSeconds(null)).toBe(0);
  });
});
