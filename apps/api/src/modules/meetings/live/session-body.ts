import type { Transform } from '@platform/note-doc';
import { appendMarkdown, replaceSectionMarkdown } from '../doc/note-edit.js';
import { AI_NOTES_SECTION } from './behaviours/note-taker.behaviour.js';
import type { LiveSession, Proposal, TranscriptLine } from './live-session.js';

export interface SessionSummary {
  aiNotes: string;
  state: { summary: string; decisions: string[]; openQuestions: string[] };
  lines: TranscriptLine[];
  openProposals: Proposal[];
  startedAt: Date;
}

/**
 * Write what a finished recording produced into the note.
 *
 * This exists because there are two capture paths — the meeting bot (LiveRunner) and the
 * browser microphone/tab socket (LiveGateway) — which each assembled the body themselves
 * and had drifted apart. The bot merged the assistant's live notes and stamped its
 * transcript with a time; the socket did neither. Same meeting, different record, depending
 * on which button you pressed. One function, used by both, is the only way that stays fixed.
 *
 * It used to return the whole body as a string, which the caller then wrote over the top of
 * whatever was in the database. That was the single largest last-write-wins hazard in the
 * platform: a recording stopping while somebody was still typing their own summary replaced
 * every character of the note, including theirs. Now it describes the same result as bounded
 * edits on the live document, so the two merge.
 *
 * Two things it does that neither original path did:
 *
 * Every appended section is stamped with the session's start time. Without that, recording
 * twice onto one note produces two `## Summary` headings with nothing to distinguish them,
 * and the reader cannot tell which meeting they are looking at — which is worse than an
 * unstructured note, because it looks authoritative.
 *
 * Non-action proposals are written down. The assistant proposes four kinds of thing —
 * actions, decisions, notes, and agenda coverage — and both paths persisted only the
 * actions, silently discarding the rest at the moment the recording stopped. The panel had
 * shown them for the whole meeting. Persisting them under a heading is not the same as
 * making them decidable, but it is the difference between a record and a loss.
 */
export function applySession(tr: Transform, session: SessionSummary): void {
  const at = stamp(session.startedAt);

  // The assistant's own section is replaced rather than appended — it is the same section it
  // has been revising all meeting, and a second copy of it would be nobody's notes.
  if (session.aiNotes.trim()) {
    replaceSectionMarkdown(tr, AI_NOTES_SECTION, session.aiNotes.trim());
  }

  // Actions become action points on their own, so listing them here too would be a second
  // copy that goes stale the moment one is accepted or dismissed.
  const suggestions = session.openProposals.filter((p) => p.kind !== 'action');

  const section = (title: string, content: string) => {
    if (!content.trim()) return;
    appendMarkdown(tr, `## ${title} — ${at}\n\n${content}`);
  };

  section('Summary', session.state.summary);
  section('Decisions', session.state.decisions.map((d) => `- ${d}`).join('\n'));
  section('Open questions', session.state.openQuestions.map((q) => `- ${q}`).join('\n'));
  section('Suggested by the assistant', suggestions.map(describe).join('\n'));

  // No transcript. It is saved as its own record — see MeetingsService.saveTranscript —
  // because this text is what gets chunked, embedded and searched, and a transcript buried
  // the note it was attached to under the speech that produced it.
}

/** A transcript as Markdown, for reading and for export. Not for the note body. */
export function formatTranscript(lines: TranscriptLine[]): string {
  return lines
    .map((l) => `${clock(l.at)} ${l.speaker ? `**${l.speaker}:** ` : ''}${l.text}`)
    .join('\n');
}

/**
 * How a surviving proposal reads once the meeting is over.
 *
 * Agenda coverage is labelled as a belief rather than a fact, because it is never applied —
 * the agenda item stays open, deliberately, since marking something covered on the strength
 * of a passing mention is the quiet kind of wrong that makes a tool untrustworthy. So the
 * note says what the assistant thought and leaves the decision where it belongs.
 */
function describe(p: Proposal): string {
  if (p.kind === 'agenda_covered') return `- Agenda item possibly covered: ${p.text}`;
  if (p.kind === 'decision') return `- Possible decision: ${p.text}`;
  return `- ${p.text}`;
}

const stamp = (d: Date) => d.toTimeString().slice(0, 5);

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

/**
 * The shape both call sites already hold, narrowed to what the note needs.
 *
 * No longer takes the current body: the document authority holds that, and passing a copy of
 * it around is what let a stale read overwrite a live one.
 */
export const sessionSummary = (session: LiveSession): SessionSummary => ({
  aiNotes: session.aiNotes,
  state: session.state,
  lines: session.lines,
  openProposals: session.openProposals,
  startedAt: session.startedAt,
});
