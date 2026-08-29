import { Injectable, Logger } from '@nestjs/common';
import { DocsService } from '../../../docs/docs.service.js';
import type { BehaviourContext, BehaviourResult, MeetingBehaviour } from './behaviour.js';

/** How often it looks, at most. Searching is cheap; searching every utterance is not useful. */
const CHECK_EVERY_MS = 45_000;

/**
 * Below this it is noise — a keyword match on a common word tells nobody anything.
 *
 * Scaled by the actions dial rather than fixed: a reserved agent wants a stronger match
 * before it puts a document on screen, and an eager one is happy to show a maybe. Search
 * relevance is not model confidence, so it gets its own multiplier rather than going through
 * the shared floor, which would be a category error dressed up as reuse.
 */
const MIN_SCORE = 0.05;
const SCORE_FACTOR = { reserved: 2, balanced: 1, eager: 0.5 } as const;

/** Two is a pointer. Five is a reading list nobody opens mid-meeting. */
const MAX_HITS = 2;

/**
 * Find the document that bears on what was just proposed.
 *
 * Everything else the assistant does here reacts to speech. This one goes and looks something
 * up, unasked — which is the only way a relevant policy can appear on screen at the moment it
 * matters rather than after somebody thinks to search for it.
 *
 * That distinction is the whole point. The chat assistant can already search documents, and
 * `wake_word` can be asked to; both require somebody to have the idea. Nobody in a meeting
 * about audit logging thinks "I should check the retention policy" — they think it three days
 * later, when the work is done wrong.
 *
 * Deliberately narrow:
 *
 *   - Only actions and decisions. A passing note is not worth a search, and agenda coverage
 *     is about the agenda rather than about anything findable.
 *   - Only once per proposal. The same document surfacing every forty-five seconds for the
 *     rest of the meeting is worse than not surfacing it.
 *   - Broadcast, never proposed and never spoken. It is context, not a commitment, and a bot
 *     reading document titles aloud in a client's meeting is an intrusion.
 *   - Nothing is persisted. What the meeting concluded belongs in the note; what the
 *     assistant happened to read does not.
 */
@Injectable()
export class ContextFinderBehaviour implements MeetingBehaviour {
  readonly name = 'context_finder';
  readonly description =
    'Looks up documents and past meetings that bear on what was just proposed.';
  readonly trigger = 'interval' as const;
  readonly intervalMs = CHECK_EVERY_MS;
  readonly canSpeak = false;
  /**
   * Actions, because what it looks up is what somebody proposed doing.
   *
   * It neither speaks nor writes, so it could plausibly answer to no dial at all — but it
   * only ever fires on an action or a decision, and an operator who has turned those down
   * has said something about how much unsolicited output they want on the subject.
   */
  readonly dial = 'actions' as const;

  private readonly logger = new Logger(ContextFinderBehaviour.name);
  /** Proposals already looked up, per note, so nothing is searched twice. */
  private readonly searched = new Map<string, Set<string>>();

  constructor(private readonly docs: DocsService) {}

  shouldRun(ctx: BehaviourContext): boolean {
    return this.pending(ctx).length > 0;
  }

  async run(ctx: BehaviourContext): Promise<BehaviourResult | null> {
    const [proposal] = this.pending(ctx);
    if (!proposal) return null;

    // Marked before searching, not after. A search that throws should not be retried every
    // interval for the rest of the meeting.
    this.remember(ctx.note.id, proposal.id);

    try {
      const floor = MIN_SCORE * SCORE_FACTOR[ctx.eagerness.actions];
      const hits = await this.docs.search(ctx.actor, proposal.text, MAX_HITS + 2);
      const useful = hits.filter((h) => h.score >= floor).slice(0, MAX_HITS);
      if (useful.length === 0) return { reason: `Nothing on file about "${proposal.text}"` };

      return {
        broadcast: [
          {
            type: 'context',
            forProposalId: proposal.id,
            hits: useful.map((h) => ({
              entityId: h.documentId,
              entityType: 'document',
              title: h.title,
              snippet: h.snippet,
              via: h.via,
            })),
          },
        ],
        reason: `Found ${useful.length} for "${proposal.text}"`,
      };
    } catch (error) {
      // Search being unavailable — no embeddings configured, a provider down — must not
      // interrupt a meeting. It is the one behaviour whose absence nobody would notice.
      this.logger.warn(`Context lookup failed: ${(error as Error).message}`);
      return { reason: 'Could not look anything up' };
    }
  }

  /** Open proposals worth a search that have not had one. */
  private pending(ctx: BehaviourContext) {
    const done = this.searched.get(ctx.note.id) ?? new Set<string>();
    return ctx.session.openProposals.filter(
      (p) => (p.kind === 'action' || p.kind === 'decision') && !done.has(p.id),
    );
  }

  private remember(noteId: string, proposalId: string): void {
    const done = this.searched.get(noteId) ?? new Set<string>();
    done.add(proposalId);
    this.searched.set(noteId, done);
  }

  /** Called when a meeting ends, so a long-running server does not accumulate note ids. */
  forget(noteId: string): void {
    this.searched.delete(noteId);
  }
}
