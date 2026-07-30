import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@platform/contracts';
import type { LlmService } from '../../../../core/llm/llm.service.js';
import { LiveSession } from '../live-session.js';
import { AgendaDriftBehaviour } from './agenda-drift.behaviour.js';
import { BehaviourRegistry } from './behaviour.registry.js';
import { WakeWordBehaviour, stripWakeWord } from './wake-word.behaviour.js';
import { AI_NOTES_HEADING, extractAiSection, mergeAiNotes } from './note-taker.behaviour.js';
import type { BehaviourContext, MeetingBehaviour } from './behaviour.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

const contextFor = (session: LiveSession, latest?: { speaker?: string; text: string }) =>
  ({
    actor,
    session,
    note: {
      id: session.noteId,
      title: 'Voortgang Power BI',
      agenda: [
        { id: 'a1', title: 'Budget', covered: false },
        { id: 'a2', title: 'Planning', covered: false },
      ],
    },
    latest: latest ? { ...latest, at: 0 } : undefined,
    tools: {},
    llm: {} as LlmService,
    newId: () => crypto.randomUUID(),
  }) as BehaviourContext;

/** A behaviour whose every decision the test controls. */
const stub = (over: Partial<MeetingBehaviour> = {}): MeetingBehaviour =>
  ({
    name: 'stub',
    description: 'a stub',
    trigger: 'utterance',
    canSpeak: true,
    shouldRun: () => true,
    run: async () => ({ speak: 'hello' }),
    ...over,
  }) as MeetingBehaviour;

describe('BehaviourRegistry', () => {
  let session: LiveSession;

  beforeEach(() => {
    session = new LiveSession(crypto.randomUUID(), actor.userId);
  });

  const registryOf = (...behaviours: MeetingBehaviour[]) =>
    new BehaviourRegistry(
      behaviours[0] as never,
      behaviours[1] as never,
      (behaviours[2] ?? stub({ name: 'unused', trigger: 'interval', shouldRun: () => false })) as never,
      (behaviours[3] ??
        stub({ name: 'unused-4', trigger: 'interval', shouldRun: () => false })) as never,
    );

  it('runs a behaviour whose trigger and gate both allow it', async () => {
    const registry = registryOf(stub(), stub({ name: 'other', trigger: 'interval' }));
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['stub', 'other']),
      maySpeak: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.speak).toBe('hello');
  });

  it('skips a behaviour the operator switched off', async () => {
    const registry = registryOf(stub(), stub({ name: 'other', trigger: 'interval' }));
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['other']),
      maySpeak: true,
    });
    expect(results).toHaveLength(0);
  });

  it('lets a behaviour propose while refusing to let it speak', async () => {
    // The meeting-wide switch is above the per-behaviour permission: turning speech off
    // must silence everything, without stopping the useful quiet work.
    const registry = registryOf(
      stub({ run: async () => ({ speak: 'out loud', proposals: [{ kind: 'note', text: 'quiet' }] }) }),
      stub({ name: 'other', trigger: 'interval' }),
    );
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['stub', 'other']),
      maySpeak: false,
    });
    expect(results[0]!.speak).toBeUndefined();
    expect(results[0]!.proposals).toHaveLength(1);
  });

  it('silences a behaviour that is not allowed to speak, even when speech is on', async () => {
    const registry = registryOf(
      stub({ canSpeak: false, run: async () => ({ speak: 'should not be said' }) }),
      stub({ name: 'other', trigger: 'interval' }),
    );
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['stub', 'other']),
      maySpeak: true,
    });
    expect(results[0]!.speak).toBeUndefined();
  });

  it('keeps going when one behaviour throws', async () => {
    // One broken behaviour must not take the meeting down with it.
    const registry = registryOf(
      stub({ name: 'broken', run: async () => { throw new Error('boom'); } }),
      stub({ name: 'fine', trigger: 'utterance' }),
    );
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['broken', 'fine']),
      maySpeak: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.speak).toBe('hello');
  });

  it('survives a behaviour whose cheap check throws', async () => {
    const registry = registryOf(
      stub({ name: 'broken', shouldRun: () => { throw new Error('boom'); } }),
      stub({ name: 'fine' }),
    );
    const results = await registry.run('utterance', contextFor(session), {
      enabled: new Set(['broken', 'fine']),
      maySpeak: true,
    });
    expect(results).toHaveLength(1);
  });

  it('respects an interval, so a timer behaviour does not run every tick', async () => {
    const run = vi.fn().mockResolvedValue({ reason: 'ok' });
    const registry = registryOf(
      stub({ name: 'timed', trigger: 'interval', intervalMs: 60_000, run }),
      stub({ name: 'other' }),
    );
    const settings = { enabled: new Set(['timed', 'other']), maySpeak: true };

    await registry.run('interval', contextFor(session), settings);
    await registry.run('interval', contextFor(session), settings);
    expect(run).toHaveBeenCalledOnce();
  });

  it('defaults to watching quietly', async () => {
    const registry = registryOf(stub(), stub({ name: 'other', trigger: 'interval' }));
    const defaults = registry.defaults();
    // Everything on, speech off: the agent is useful from the first meeting and does not
    // surprise a client by talking.
    expect(defaults.enabled.size).toBe(4);
    expect(defaults.maySpeak).toBe(false);
  });

  it('lists what it can do, for the UI and the docs page', () => {
    const registry = registryOf(stub(), stub({ name: 'other', trigger: 'interval' }));
    expect(registry.list().map((b) => b.name)).toEqual(['stub', 'other', 'unused', 'unused-4']);
  });
});

describe('WakeWordBehaviour', () => {
  const behaviour = new WakeWordBehaviour();
  const session = new LiveSession(crypto.randomUUID(), actor.userId);

  it('wakes on its name', () => {
    expect(behaviour.shouldRun(contextFor(session, { text: 'Finsera, wat hebben we geoffreerd?' }))).toBe(true);
  });

  it('wakes on a mangled name, because speech recognition mangles names', () => {
    // Insisting on one spelling would make the feature feel broken half the time.
    expect(behaviour.shouldRun(contextFor(session, { text: 'Vinsera, hoeveel uur staat er open?' }))).toBe(true);
  });

  it('stays asleep otherwise', () => {
    expect(behaviour.shouldRun(contextFor(session, { text: 'We moeten het dashboard uitbreiden.' }))).toBe(false);
  });

  it('never wakes on its own voice', () => {
    // Otherwise the meeting becomes the bot addressing the bot.
    expect(
      behaviour.shouldRun(contextFor(session, { speaker: 'Assistant', text: 'Finsera denkt mee.' })),
    ).toBe(false);
  });

  it('handles an empty line', () => {
    expect(behaviour.shouldRun(contextFor(session))).toBe(false);
  });
});

describe('stripWakeWord', () => {
  it('leaves the question behind', () => {
    expect(stripWakeWord('Finsera, wat hebben we vorige keer geoffreerd?')).toBe(
      'wat hebben we vorige keer geoffreerd?',
    );
  });

  it('copes with the name mid-sentence', () => {
    expect(stripWakeWord('Hey Finsera hoeveel uur staat open')).toContain('hoeveel uur staat open');
  });
});

describe('AgendaDriftBehaviour', () => {
  const behaviour = new AgendaDriftBehaviour();

  it('does not run before anything has been said', () => {
    const session = new LiveSession(crypto.randomUUID(), actor.userId);
    expect(behaviour.shouldRun(contextFor(session))).toBe(false);
  });

  it('does not run when there is no agenda to drift from', () => {
    const session = new LiveSession(crypto.randomUUID(), actor.userId);
    session.addLine('x'.repeat(2_000));
    const ctx = contextFor(session);
    ctx.note.agenda = [];
    expect(behaviour.shouldRun(ctx)).toBe(false);
  });

  it('does not run when every item is already covered', () => {
    const session = new LiveSession(crypto.randomUUID(), actor.userId);
    session.addLine('x'.repeat(2_000));
    const ctx = contextFor(session);
    ctx.note.agenda = ctx.note.agenda.map((a) => ({ ...a, covered: true }));
    expect(behaviour.shouldRun(ctx)).toBe(false);
  });

  it('runs once there is an agenda and enough conversation', () => {
    const session = new LiveSession(crypto.randomUUID(), actor.userId);
    session.addLine('x'.repeat(2_000));
    expect(behaviour.shouldRun(contextFor(session))).toBe(true);
  });

  it('is timer-driven, because drift is the absence of something being said', () => {
    expect(behaviour.trigger).toBe('interval');
    expect(behaviour.intervalMs).toBeGreaterThan(60_000);
  });
});

describe('note merging', () => {
  it('adds the assistant section when there is none', () => {
    const merged = mergeAiNotes('# My own notes\n\nSomething I typed.', '- A decision');
    expect(merged).toContain('# My own notes');
    expect(merged).toContain(AI_NOTES_HEADING);
    expect(merged).toContain('- A decision');
  });

  it('replaces only its own section, leaving what you wrote alone', () => {
    // The whole reason for the ownership boundary: notes appearing must never eat
    // something the operator typed.
    const body = [
      '# My own notes',
      '',
      'Something I typed.',
      '',
      AI_NOTES_HEADING,
      '',
      '- An old point',
      '',
      '## Transcript — 14:32',
      '',
      '[00:01] Someone said something.',
    ].join('\n');

    const merged = mergeAiNotes(body, '- A better point');

    expect(merged).toContain('Something I typed.');
    expect(merged).toContain('- A better point');
    expect(merged).not.toContain('- An old point');
    // And the section after it survives.
    expect(merged).toContain('## Transcript — 14:32');
    expect(merged).toContain('[00:01] Someone said something.');
  });

  it('reads its own section back for revision', () => {
    const body = `${AI_NOTES_HEADING}\n\n- Point one\n- Point two\n\n## Transcript\n\nline`;
    expect(extractAiSection(body)).toBe('- Point one\n- Point two');
  });

  it('returns nothing when the assistant has written nothing', () => {
    expect(extractAiSection('# Just my notes')).toBe('');
  });

  it('handles an empty document', () => {
    expect(mergeAiNotes('', '- First note')).toContain('- First note');
  });
});
