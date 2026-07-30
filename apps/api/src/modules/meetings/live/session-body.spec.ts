import { describe, expect, it } from 'vitest';
import { assembleBody, formatTranscript } from './session-body.js';
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

const session = (over: Partial<Parameters<typeof assembleBody>[0]> = {}) => ({
  body: '',
  aiNotes: '',
  state: { summary: '', decisions: [], openQuestions: [] },
  lines: [line(0, 'Hello')],
  openProposals: [],
  startedAt: new Date('2026-07-29T14:35:00'),
  ...over,
});

describe('assembleBody', () => {
  it('records the proposals that are not actions', () => {
    const body = assembleBody(
      session({
        openProposals: [
          proposal('action', 'Send the dataset'),
          proposal('note', 'They are on Snowflake now'),
          proposal('decision', 'Weekly rather than daily refresh'),
          proposal('agenda_covered', 'Data model walkthrough'),
        ],
      }),
    );

    expect(body).toContain('They are on Snowflake now');
    expect(body).toContain('Possible decision: Weekly rather than daily refresh');
    expect(body).toContain('Agenda item possibly covered: Data model walkthrough');
  });

  it('leaves actions out of the body, because they become action points', () => {
    const body = assembleBody(
      session({ openProposals: [proposal('action', 'Send the dataset')] }),
    );

    expect(body).not.toContain('Send the dataset');
    expect(body).not.toContain('Suggested by the assistant');
  });

  it('stamps every section, so a second recording does not read as one meeting', () => {
    const first = assembleBody(
      session({ state: { summary: 'Scoped the model', decisions: ['Go weekly'], openQuestions: [] } }),
    );
    const second = assembleBody(
      session({
        body: first,
        startedAt: new Date('2026-07-29T16:10:00'),
        state: { summary: 'Reviewed the build', decisions: ['Ship Friday'], openQuestions: [] },
      }),
    );

    expect(second).toContain('## Summary — 14:35');
    expect(second).toContain('## Summary — 16:10');
    expect(second).toContain('Scoped the model');
    expect(second).toContain('Reviewed the build');
  });

  it("replaces the assistant's own notes section and keeps what was typed around it", () => {
    const body = assembleBody(
      session({
        body: `My own agenda\n\n${AI_NOTES_HEADING}\n\nStale notes\n`,
        aiNotes: 'Fresh notes',
      }),
    );

    expect(body).toContain('My own agenda');
    expect(body).toContain('Fresh notes');
    expect(body).not.toContain('Stale notes');
  });

  it('keeps the transcript out of the note entirely', () => {
    const body = assembleBody(
      session({ lines: [line(65, 'We need supplier drill-down', 'Anna')] }),
    );

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
