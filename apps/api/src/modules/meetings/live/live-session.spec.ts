import { describe, expect, it } from 'vitest';
import { LiveSession, similar } from './live-session.js';

let counter = 0;
const newId = () => `id-${++counter}`;

describe('LiveSession', () => {
  it('timestamps lines from the start of the session', () => {
    const session = new LiveSession('note', 'actor', new Date(Date.now() - 65_000));
    const line = session.addLine('We should add supplier drill-down.');
    expect(line?.at).toBeGreaterThanOrEqual(64);
    expect(line?.text).toBe('We should add supplier drill-down.');
  });

  it('ignores empty or whitespace segments', () => {
    const session = new LiveSession('note', 'actor');
    expect(session.addLine('   ')).toBeNull();
    expect(session.addLine('')).toBeNull();
    expect(session.lines).toHaveLength(0);
  });

  it('keeps the window bounded however long the meeting runs', () => {
    const session = new LiveSession('note', 'actor');
    // Two hours of dense speech.
    for (let i = 0; i < 2_000; i++) session.addLine(`Line number ${i} with some content.`);

    expect(session.transcript.length).toBeGreaterThan(50_000);
    // This is the property that makes cost flat rather than quadratic.
    expect(session.window().length).toBeLessThanOrEqual(4_000);
  });

  it('extracts on volume of new speech, not on a timer', () => {
    const session = new LiveSession('note', 'actor');
    expect(session.shouldExtract()).toBe(false);

    session.addLine('a'.repeat(950));
    expect(session.shouldExtract()).toBe(true);

    session.markExtracted();
    expect(session.shouldExtract()).toBe(false);

    session.addLine('b'.repeat(100));
    expect(session.shouldExtract()).toBe(false); // a quiet stretch costs nothing
  });

  it('never runs two extractions at once', () => {
    const session = new LiveSession('note', 'actor');
    session.addLine('a'.repeat(2_000));
    session.extracting = true;
    expect(session.shouldExtract()).toBe(false);
  });

  it('merges proposals and refuses near-duplicates', () => {
    const session = new LiveSession('note', 'actor');
    const first = session.mergeProposals(
      [{ kind: 'action', text: 'Add supplier-level drill-down to the spend model' }],
      newId,
    );
    expect(first).toHaveLength(1);

    // The window overlaps each tick, so the model re-suggests things in different words.
    // A duplicate is worse than a miss: it teaches you to stop reading the panel.
    const second = session.mergeProposals(
      [{ kind: 'action', text: 'Add a supplier level drill down to the spend model.' }],
      newId,
    );
    expect(second).toHaveLength(0);
    expect(session.proposals).toHaveLength(1);
  });

  it('keeps a genuinely different proposal', () => {
    const session = new LiveSession('note', 'actor');
    session.mergeProposals([{ kind: 'action', text: 'Add supplier drill-down' }], newId);
    const added = session.mergeProposals(
      [{ kind: 'action', text: 'Move the workshop to September' }],
      newId,
    );
    expect(added).toHaveLength(1);
    expect(session.proposals).toHaveLength(2);
  });

  it('treats the same words under a different kind as different', () => {
    const session = new LiveSession('note', 'actor');
    session.mergeProposals([{ kind: 'action', text: 'Move the workshop to September' }], newId);
    const added = session.mergeProposals(
      [{ kind: 'decision', text: 'Move the workshop to September' }],
      newId,
    );
    expect(added).toHaveLength(1);
  });

  it('reports only open proposals', () => {
    const session = new LiveSession('note', 'actor');
    session.mergeProposals(
      [
        { kind: 'action', text: 'One thing entirely' },
        { kind: 'action', text: 'Another separate matter' },
      ],
      newId,
    );
    session.proposals[0]!.status = 'dismissed';
    expect(session.openProposals).toHaveLength(1);
  });
});

describe('similar', () => {
  it('matches rewording', () => {
    expect(similar('Send the updated dataset to the client', 'Send updated dataset to client')).toBe(
      true,
    );
  });

  it('does not match different intents that share a word', () => {
    expect(similar('Send the dataset', 'Delete the old reports')).toBe(false);
  });

  it('does not match on short filler words alone', () => {
    expect(similar('the and but for', 'the and but for')).toBe(false);
  });

  describe('pausing', () => {
    it('starts out listening', () => {
      expect(new LiveSession('note', 'actor').paused).toBe(false);
    });

    it('marks where listening stopped and started again', () => {
      const session = new LiveSession('note', 'actor');
      session.addLine('Before.');

      const paused = session.mark('paused');
      expect(session.paused).toBe(true);
      expect(paused?.kind).toBe('paused');

      const resumed = session.mark('resumed');
      expect(session.paused).toBe(false);
      // Not a 'paused' line: the marker that ENDS a gap is not itself a gap, and rendering it
      // as one would grey out everything said afterwards.
      expect(resumed?.kind).toBe('speech');
    });

    it('says nothing when nothing changed', () => {
      const session = new LiveSession('note', 'actor');
      expect(session.mark('resumed')).toBeNull(); // already listening

      session.mark('paused');
      // Pausing an already-paused meeting is not an event, and two markers in a row would
      // read as a gap inside a gap.
      expect(session.mark('paused')).toBeNull();
      expect(session.lines.filter((l) => l.kind === 'paused')).toHaveLength(1);
    });

    it('puts the gap in the transcript the model reads', () => {
      const session = new LiveSession('note', 'actor');
      session.addLine('We will ship on Friday.');
      session.mark('paused');
      session.mark('resumed');
      session.addLine('So that is agreed.');

      /*
       * The point of the marker. Without it those two lines read as one continuous exchange
       * and an extraction will happily invent the connection between them.
       */
      expect(session.transcript).toContain('listening paused');
      const gap = session.transcript.indexOf('listening paused');
      expect(gap).toBeGreaterThan(session.transcript.indexOf('ship on Friday'));
      expect(gap).toBeLessThan(session.transcript.indexOf('So that is agreed'));
    });

    it('leaves everything gathered so far alone', () => {
      const session = new LiveSession('note', 'actor');
      session.addLine('Something worth keeping.');
      session.mergeProposals([{ kind: 'action', text: 'Send the dataset' }], newId);

      session.mark('paused');

      // Pausing is not stopping: the meeting so far is still the meeting.
      expect(session.lines.some((l) => l.text === 'Something worth keeping.')).toBe(true);
      expect(session.openProposals).toHaveLength(1);
    });
  });
});
