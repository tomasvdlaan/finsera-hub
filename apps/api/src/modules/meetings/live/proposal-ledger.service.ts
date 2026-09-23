import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../../../core/db/db.module.js';
import { proposals as proposalRows } from '../meetings.schema.js';
import type { Proposal } from './live-session.js';

/**
 * A dismissal that arrives faster than a person can read the card.
 *
 * Measured from the moment the suggestion reached the front of the queue, not from when it
 * was proposed — see `LiveSession.promote`. Below this the press says something about the
 * operator's attention and nothing about the suggestion, so it is recorded as a reflex and
 * excluded from anything that treats dismissals as evidence.
 *
 * Twelve hundred milliseconds because a card is two lines of text: reading it and deciding
 * takes longer than that, and a press inside it is the hand that was already moving. The
 * exact figure matters less than that the class exists — everything downstream filters on
 * the reason, so a slightly wrong boundary mislabels a few rows rather than poisoning a
 * conclusion.
 */
const REFLEX_MS = 1_200;

export interface ProposalContext {
  /** The behaviour that produced it, or 'extraction' for the runner's own pass. */
  source: string;
  /** The dial in force for this kind of proposal. */
  eagerness?: string;
  /** What `triage()` scored the passage at. */
  triageScore?: number;
  /** The stretch of transcript it was drawn from. */
  window?: string;
}

/**
 * What the agent suggested, and what a person did about it.
 *
 * ## Why this is a service and not two lines in the runner
 *
 * Because the runner must never fail a meeting for it. Every method here swallows its own
 * errors, the same contract `UsageService` holds: a recording that stopped because a ledger
 * insert deadlocked would be a far worse outcome than a missing row. Nothing downstream
 * reads this during a meeting, so a gap costs a data point and nothing else.
 *
 * ## What it is for
 *
 * One question, asked later: of everything the agent proposed, what did a person actually
 * want? Nothing in the platform could answer that before — a proposal lived in memory for
 * the length of one recording and left only its effects behind. Until there is a corpus,
 * every threshold in `eagerness.ts` is a guess that cannot be checked, and swapping the
 * model's self-reported confidence for a calibrated one has nothing to calibrate against.
 *
 * ## The one thing it must get right
 *
 * Distinguishing a judgement from a reflex. A dismissal is the only signal the panel now
 * produces, and most of them will be worth nothing: the operator is in a meeting, the card
 * is in the way, and the press is a swat. Recording all of them as equal is how this table
 * becomes as meaningless as the accept button it replaces.
 */
@Injectable()
export class ProposalLedger {
  private readonly logger = new Logger(ProposalLedger.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Write down what was proposed, before anybody has an opinion about it. */
  async recorded(
    noteId: string,
    added: readonly Proposal[],
    context: ProposalContext,
  ): Promise<void> {
    if (added.length === 0) return;
    try {
      await this.db.insert(proposalRows).values(
        added.map((p) => ({
          id: p.id,
          noteId,
          kind: p.kind,
          text: p.text,
          source: p.source ?? context.source,
          confidence: p.confidence ?? null,
          triageScore: context.triageScore ?? null,
          eagerness: context.eagerness ?? null,
          queuedAhead: p.queuedAhead ?? 0,
          window: context.window ?? null,
          shownAt: p.shownAt ? new Date(p.shownAt) : null,
        })),
      );
    } catch (error) {
      this.logger.warn(`Could not record proposals on ${noteId}: ${(error as Error).message}`);
    }
  }

  /**
   * Record that somebody objected, and how much the objection is worth.
   *
   * `shownAt` comes from the session rather than the row: the proposal may have been
   * promoted to the front of the queue after it was written, and the session is where that
   * happened. Writing it back here keeps the two in step.
   */
  async dismissed(
    proposal: Proposal,
    actorId: string,
    opts: { alreadyInNote?: boolean; at?: number } = {},
  ): Promise<void> {
    const at = opts.at ?? Date.now();
    const shownAt = proposal.shownAt ?? at;
    const decisionMs = Math.max(0, at - shownAt);
    try {
      await this.db
        .update(proposalRows)
        .set({
          outcome: 'dismissed',
          dismissReason: reasonFor(decisionMs, opts.alreadyInNote ?? false),
          decidedBy: actorId,
          decidedAt: new Date(at),
          shownAt: new Date(shownAt),
          decisionMs,
        })
        .where(eq(proposalRows.id, proposal.id));
    } catch (error) {
      this.logger.warn(`Could not record dismissal of ${proposal.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Record that somebody kept one on purpose.
   *
   * Only agenda coverage can reach this: it is the one suggestion whose acceptance does
   * something no other path does. The outcome is the same `kept` a silent meeting produces,
   * because the note ends up in the same state either way — what distinguishes them is
   * `decidedAt`, which is null for everything nobody touched. Inventing a fourth outcome to
   * say "kept, and somebody said so" would put the difference in two places.
   */
  async kept(proposal: Proposal, actorId: string, at = Date.now()): Promise<void> {
    const shownAt = proposal.shownAt ?? at;
    try {
      await this.db
        .update(proposalRows)
        .set({
          outcome: 'kept',
          decidedBy: actorId,
          decidedAt: new Date(at),
          shownAt: new Date(shownAt),
          decisionMs: Math.max(0, at - shownAt),
        })
        .where(eq(proposalRows.id, proposal.id));
    } catch (error) {
      this.logger.warn(`Could not record keep of ${proposal.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Close the books when the recording stops.
   *
   * Everything still open was kept — that is what silence means here, and leaving those
   * rows `open` would make an undisturbed meeting look like a crashed one. Only rows that
   * are still `open` are touched, so a dismissal recorded mid-meeting is never overwritten
   * by the sweep that follows it.
   */
  async settled(noteId: string, keptIds: readonly string[]): Promise<void> {
    if (keptIds.length === 0) return;
    try {
      await this.db
        .update(proposalRows)
        .set({ outcome: 'kept' })
        .where(
          and(
            eq(proposalRows.noteId, noteId),
            eq(proposalRows.outcome, 'open'),
            inArray(proposalRows.id, [...keptIds]),
          ),
        );
    } catch (error) {
      this.logger.warn(`Could not settle proposals on ${noteId}: ${(error as Error).message}`);
    }
  }

}

/**
 * Which of the three kinds of dismissal this was.
 *
 * Duplicate first, and deliberately ahead of the timing check: recognising something you
 * read two minutes ago takes no time at all, so a fast press on a suggestion the note
 * already contains is the *expected* response rather than an inattentive one. Ordering
 * reflex first would file most duplicates as noise and hide the agent's most fixable
 * failure — repeating itself — behind its least informative one.
 *
 * `judged` is what is left: slow enough to have been read, about something the note does
 * not already say. That is the only class anything downstream should treat as evidence
 * about the suggestion itself.
 */
function reasonFor(decisionMs: number, alreadyInNote: boolean): 'judged' | 'reflex' | 'duplicate' {
  if (alreadyInNote) return 'duplicate';
  return decisionMs < REFLEX_MS ? 'reflex' : 'judged';
}
