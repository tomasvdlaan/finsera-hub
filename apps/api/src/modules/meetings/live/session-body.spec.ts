import { describe, expect, it } from 'vitest';
import { Transform, docToMarkdown, markdownToDoc } from '@platform/note-doc';
import { applySession, formatTranscript, type SessionSummary } from './session-body.js';
import { AI_NOTES_HEADING } from './behaviours/note-taker.behaviour.js';
import type { Proposal, TranscriptLine } from './live-session.js';

const line = (at: number, text: string, speaker?: string): TranscriptLine => ({
  id: `l${at}`,
  at,
  text,
  speaker,
});

const proposal = (kind: Proposal['kind'], text: string): Proposal => ({
  id: `p-${kind}-${text}`,
  kind,
  text,
  status: 'open',
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  aiNotes: '',
  state: { summary: '', decisions: [], openQuestions: [] },
  lines: [line(0, 'Hello')],
  keptProposals: [],
  startedAt: new Date('2026-07-29T14:35:00'),
  ...over,
});

/**
 * Apply a finished session to a note and read back what it says.
 *
 * `applySession` describes bounded edits on a document rather than returning a new body, so
 * the assertions go through a Transform. What is being checked is unchanged: which sections
 * appear, which are stamped, and what is left alone.
 */
const applyTo = (body: string, over: Partial<SessionSummary> = {}): string => {
  const tr = new Transform(markdownToDoc(body));
  applySession(tr, session(over));
  return docToMarkdown(tr.doc);
};

describe('applySession', () => {
  it('records the proposals that are not actions', () => {
    const body = applyTo('', {
      keptProposals: [
        proposal('action', 'Send the dataset'),
        proposal('note', 'They are on Snowflake now'),
        proposal('decision', 'Weekly rather than daily refresh'),
        proposal('agenda_covered', 'Data model walkthrough'),
      ],
    });

    // The note joins the write-up; the decision joins the decisions. Each in one place.
    expect(body).toContain('They are on Snowflake now');
    expect(body).toContain('Weekly rather than daily refresh');

    /*
     * Agenda coverage is a guess about the agenda, and it stayed a guess — the item is never
     * marked covered. Printing it into the record that gets mailed to a client read as
     * "Agenda item possibly covered: Blockers", three times over, in a real meeting. It
     * belongs in the live panel, which is where it can still be acted on.
     */
    expect(body).not.toContain('Data model walkthrough');
  });

  it('leaves actions out of the body, because they become action points', () => {
    const body = applyTo('', { keptProposals: [proposal('action', 'Send the dataset')] });

    expect(body).not.toContain('Send the dataset');
    expect(body).not.toContain('Suggested by the assistant');
  });

  /*
   * Recording twice used to append `## Summary — 14:35` and `## Summary — 16:10`, so the note
   * grew a heading per recording and the ceremony's own `## Decisions` sat empty beside them.
   * The second recording now adds to the section the first one wrote, which keeps both
   * accounts without making the reader choose between two headings of the same name.
   */
  it('adds a second recording to the same sections rather than new ones', () => {
    const first = applyTo('', {
      state: { summary: 'Scoped the model', decisions: ['Go weekly'], openQuestions: [] },
    });
    const second = applyTo(first, {
      startedAt: new Date('2026-07-29T16:10:00'),
      state: { summary: 'Reviewed the build', decisions: ['Ship Friday'], openQuestions: [] },
    });

    // Nothing from either recording is lost.
    expect(second).toContain('Scoped the model');
    expect(second).toContain('Reviewed the build');
    expect(second).toContain('Go weekly');
    expect(second).toContain('Ship Friday');

    // And there is one of each heading, not one per recording.
    expect(second.split('\n').filter((l) => l.trim() === '## Summary')).toHaveLength(1);
    expect(second.split('\n').filter((l) => l.trim() === '## Decisions')).toHaveLength(1);
    expect(second).not.toMatch(/## \w[\w ]* — \d{2}:\d{2}/);
  });

  it("replaces the assistant's own notes section and keeps what was typed around it", () => {
    const body = applyTo(`My own agenda\n\n${AI_NOTES_HEADING}\n\nStale notes\n`, {
      aiNotes: 'Fresh notes',
    });

    expect(body).toContain('My own agenda');
    expect(body).toContain('Fresh notes');
    expect(body).not.toContain('Stale notes');
  });

  it('keeps the transcript out of the note entirely', () => {
    const body = applyTo('', { lines: [line(65, 'We need supplier drill-down', 'Anna')] });

    // The whole reason this function exists in its current form: the body is what gets
    // chunked, embedded and searched, and speech drowned the note it was attached to.
    expect(body).not.toContain('We need supplier drill-down');
    expect(body).not.toContain('Transcript');
  });
});

describe('formatTranscript', () => {
  it('attributes a line to a speaker when the capture provider knew one', () => {
    expect(formatTranscript([line(65, 'We need supplier drill-down', 'Anna')])).toBe(
      '[01:05] **Anna:** We need supplier drill-down',
    );
  });

  it('leaves the attribution off when nobody knew who spoke', () => {
    expect(formatTranscript([line(5, 'Someone said this')])).toBe('[00:05] Someone said this');
  });
});
