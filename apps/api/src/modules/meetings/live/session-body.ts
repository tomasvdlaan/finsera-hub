import { docToMarkdown, type Transform } from '@platform/note-doc';
import { replaceSectionMarkdown } from '../doc/note-edit.js';
import {
  AI_NOTES_SECTION,
  isBlankForm,
  sectionMarkdownOf,
} from './behaviours/note-taker.behaviour.js';
import type { LiveSession, Proposal, TranscriptLine } from './live-session.js';

export interface SessionSummary {
  aiNotes: string;
  state: { summary: string; decisions: string[]; openQuestions: string[] };
  lines: TranscriptLine[];
  /** Everything not dismissed — see LiveSession.keptProposals. */
  keptProposals: Proposal[];
  startedAt: Date;
}

/**
 * Write a section, replacing only what the machine is allowed to replace.
 *
 * Absent, empty, or still the template's blank form: replace, because none of those is
 * anybody's writing. Anything else: append below it. Same rule the live note-taker follows —
 * see `permitted` — so a recording that stops cannot overwrite a summary you typed yourself,
 * and the two writers cannot disagree about what is safe.
 */
function writeSection(tr: Transform, heading: string, content: string): void {
  const body = content.trim();
  if (!body) return;
  const existing = sectionMarkdownOf(docToMarkdown(tr.doc), heading).trim();
  if (!existing || isBlankForm(existing)) {
    replaceSectionMarkdown(tr, heading, body);
    return;
  }
  replaceSectionMarkdown(tr, heading, `${existing}\n\n${body}`);
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
 *
 * Notes are no longer among them. They go into the document as they are heard — see
 * LiveRunner.recordNotes — so what happens here is a replacement of that same section, not a
 * second copy of it under a different heading.
 */
export function applySession(tr: Transform, session: SessionSummary): void {
  // The assistant's own section is replaced rather than appended — it is the same section it
  // has been revising all meeting, and a second copy of it would be nobody's notes.
  if (session.aiNotes.trim()) {
    replaceSectionMarkdown(tr, AI_NOTES_SECTION, session.aiNotes.trim());
  }

  /*
   * Summary, decisions and open questions go under the headings the note already has.
   *
   * They used to be appended as `## Summary — 14:37`, a fresh section per recording. On a note
   * that already carried the ceremony's own `## Decisions` heading, that produced two headings
   * about decisions — one empty because nothing ever filled it, one stamped with a time — and
   * left the reader to work out which was the record. The stamp was there so two recordings of
   * one meeting stayed apart; putting them under stable headings solves that better, because
   * the second recording revises the first rather than sitting beside it.
   *
   * `writeSection` replaces only what the machine may replace — an absent, empty or blank-form
   * section — and appends otherwise, so a summary you have edited yourself is never lost.
   */
  writeSection(tr, 'Summary', session.state.summary);

  /*
   * Decisions come from two places and must end up in one.
   *
   * The rolling state holds what the extractor concluded; `keptProposals` holds the ones you
   * were asked about and said yes to. Writing only the first would mean that ACCEPTING a
   * decision — pressing the button that says "yes, record that" — was the one way to keep it
   * out of the note. That inversion existed once and is what the guard below is for.
   */
  writeSection(
    tr,
    'Decisions',
    bullets(
      merged(
        session.state.decisions,
        session.keptProposals.filter((p) => p.kind === 'decision').map((p) => p.text),
      ),
    ),
  );

  writeSection(tr, 'Open questions', bullets(session.state.openQuestions));

  /*
   * What the assistant noticed, folded into the write-up rather than listed beside it.
   *
   * These were mirrored into a section of their own, next to the narrative the note-taker was
   * building from the same conversation — so a finished note carried the meeting twice, in two
   * voices, and the reader had to compare them to find out whether they disagreed. Merged in
   * here, and only the ones the write-up does not already make: the note-taker usually says the
   * same thing in better prose, and when it does, this adds nothing.
   *
   * Appended after the write-up, never woven into it. This runs when the recording stops, so
   * the note-taker has had its last pass and nothing will overwrite this afterwards.
   */
  const noticed = merged(
    [],
    session.keptProposals.filter((p) => p.kind === 'note').map((p) => p.text),
  ).filter((t) => !mentions(session.aiNotes, t));
  if (noticed.length > 0) {
    const existing = sectionMarkdownOf(docToMarkdown(tr.doc), AI_NOTES_SECTION).trim();
    replaceSectionMarkdown(
      tr,
      AI_NOTES_SECTION,
      existing ? `${existing}\n\n${bullets(noticed)}` : bullets(noticed),
    );
  }

  /*
   * Agenda coverage is not a document.
   *
   * `## Suggested by the assistant` used to be appended here, and on a real meeting it read
   * "Agenda item possibly covered: Blockers" three times over — a guess about the agenda, in
   * the record that gets printed and mailed to a client. It belongs in the live panel, where
   * it is already shown and can be acted on, and nowhere else. Actions are excluded for a
   * different reason: they become action points, and a copy here would go stale the moment one
   * was accepted.
   *
   * Notes are excluded because they are the same facts the assistant has been writing up all
   * meeting. Keeping a second list of them under its own heading was the largest single source
   * of duplication in a finished note — the reader got the meeting twice, in two voices.
   */

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
  keptProposals: session.keptProposals,
  startedAt: session.startedAt,
});

/** Lines as a Markdown list, or '' when there is nothing to list. */
function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

/**
 * Two lists of the same kind of thing, in order, without saying anything twice.
 *
 * Compared on normalised text rather than identity: the extractor's running state and the
 * proposal you accepted are the same sentence arrived at twice, and they differ only in
 * punctuation and case often enough that identity would let both through.
 */
function merged(first: string[], second: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...first, ...second]) {
    const text = item.trim();
    const key = normalise(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Whether a body already says a thing, allowing for it being worded a little differently. */
function mentions(body: string, text: string): boolean {
  const hay = normalise(body);
  const needle = normalise(text);
  if (!needle) return true;
  if (hay.includes(needle)) return true;
  /*
   * A long opening in common counts as already said.
   *
   * The write-up and the extractor produce the same fact in different registers — "Dhany will
   * share the repository" against "Dhany Indraswara to share access to the GitHub repository".
   * Whole-string containment misses that and the reader gets both.
   */
  const head = needle.slice(0, 40);
  return head.length >= 40 && hay.includes(head);
}

const normalise = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
