import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { clearing, guidance } from '../eagerness.js';
import type { BehaviourContext, BehaviourResult, MeetingBehaviour } from './behaviour.js';

/** Long enough that a normal digression is not treated as drift. */
const CHECK_EVERY_MS = 4 * 60 * 1000;
/** Nothing to drift from before this much has been said. */
const MIN_CHARS = 1_500;

interface DriftCheck {
  drifting: boolean;
  /** How sure it is that the meeting has genuinely wandered, filtered against the dial. */
  confidence: number;
  nudge: string;
  covered: string[];
}

const DRIFT: z.ZodType<DriftCheck> = z.object({
  drifting: z
    .boolean()
    .describe('True only if the conversation has genuinely left the agenda for a while.'),
  confidence: z.number().min(0).max(1).describe('Your odds that saying this aloud would help.'),
  nudge: z
    .string()
    .describe('One short sentence naming what has not been covered. Empty unless drifting.'),
  covered: z
    .array(z.string())
    .describe('Ids of agenda items now clearly discussed. Empty if unsure.'),
});

/**
 * Notice when a meeting has wandered.
 *
 * On a timer rather than on speech, because drift is not something anybody says — it is
 * the absence of something being said, and an utterance-triggered check would fire
 * hundreds of times to notice nothing.
 *
 * Deliberately reluctant. Every meeting digresses, and most digressions are the useful
 * part; a bot that says "we have not covered item three" every four minutes gets muted
 * within one meeting. It is told to report drift only when the conversation has genuinely
 * left the agenda, and coverage is proposed rather than applied because "we mentioned it"
 * and "we dealt with it" are different things only a person can tell apart.
 */
@Injectable()
export class AgendaDriftBehaviour implements MeetingBehaviour {
  readonly name = 'agenda_drift';
  readonly description =
    'Watches whether the meeting is still on its agenda, and proposes which items have been covered.';
  readonly trigger = 'interval' as const;
  readonly intervalMs = CHECK_EVERY_MS;
  readonly canSpeak = true;
  /**
   * Speech, not actions.
   *
   * Its coverage proposals only ever tick a box the meeting already has, which is nearly
   * free to be wrong about — a person unticks it. What is expensive is the nudge, which
   * interrupts the room. So it answers to the dial that governs interrupting.
   */
  readonly dial = 'speech' as const;

  private readonly logger = new Logger(AgendaDriftBehaviour.name);

  shouldRun(ctx: BehaviourContext): boolean {
    // No agenda, nothing to drift from — and that is a normal way to run a meeting.
    const open = ctx.note.agenda.filter((a) => !a.covered);
    return open.length > 0 && ctx.session.transcript.length >= MIN_CHARS;
  }

  async run(ctx: BehaviourContext): Promise<BehaviourResult | null> {
    const open = ctx.note.agenda.filter((a) => !a.covered);

    const result = await ctx.llm.generateStructured<DriftCheck>({
      context: { module: 'meetings', feature: 'agenda-drift' },
      schema: DRIFT,
      role: 'fast',
      system: [
        'You are tracking whether a business meeting is still following its agenda.',
        '',
        'Be reluctant to report drift. Meetings digress, and the digression is often the',
        'valuable part. Report it only when the conversation has been somewhere else for',
        'a sustained stretch and an agenda item looks likely to be missed.',
        '',
        'Mark an item covered only if it was actually discussed, not merely mentioned.',
        'If unsure, leave it uncovered — a person can tick a box, and wrongly ticking one',
        'loses information nobody notices is gone.',
        '',
        guidance('speech', ctx.eagerness.speech),
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Meeting: ${ctx.note.title}`,
            '',
            'Agenda items not yet marked covered:',
            open.map((a) => `- [${a.id}] ${a.title}`).join('\n'),
            '',
            'The recent conversation:',
            '---',
            ctx.session.window(),
            '---',
          ].join('\n'),
        },
      ],
    });

    ctx.session.tokensIn += result.usage.inputTokens;
    ctx.session.tokensOut += result.usage.outputTokens;

    const { covered, drifting, nudge } = result.object;
    /*
     * The floor applies to the nudge and not to the coverage.
     *
     * They are the same model call but two different consequences: interrupting a room on a
     * hunch is the thing the dial exists to prevent, while a coverage suggestion sits
     * silently in a panel until somebody agrees with it. Filtering both would make a reserved
     * agent stop noticing the agenda, which is not what reserved means.
     */
    const speakable = clearing([result.object], ctx.eagerness.speech).length > 0;
    const validIds = new Set(open.map((a) => a.id));
    const proposals = covered
      .filter((id) => validIds.has(id))
      .map((id) => ({
        kind: 'agenda_covered' as const,
        text: open.find((a) => a.id === id)!.title,
        agendaItemId: id,
      }));

    if (!drifting && proposals.length === 0) {
      return { reason: 'On topic, nothing newly covered' };
    }

    this.logger.log(
      `Agenda check on ${ctx.note.id}: ${proposals.length} covered, drifting=${drifting}`,
    );

    return {
      proposals,
      // Only speaks when actually drifting. Coverage is a side-panel matter.
      speak: drifting && speakable && nudge.trim() ? nudge.trim() : undefined,
    };
  }
}
