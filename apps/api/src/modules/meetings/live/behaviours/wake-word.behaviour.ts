import { Injectable, Logger } from '@nestjs/common';
import type { BehaviourContext, BehaviourResult, MeetingBehaviour } from './behaviour.js';

/**
 * Words that get the assistant's attention.
 *
 * Several, because speech recognition will mangle any single one of them — "Finsera"
 * comes back as "Vinsera" or "Finseira" often enough that insisting on one spelling
 * would make the feature feel broken.
 */
const WAKE_WORDS = (process.env.MEETING_WAKE_WORDS ?? 'finsera,vinsera,finsara,assistent')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

/**
 * Answer when spoken to.
 *
 * This is the behaviour that earns the agent its place: asked "what did we quote them
 * last time?", it can actually look — quotes, invoices, contracts, hours, past meeting
 * notes are all tools it already has. Nobody else in the meeting can answer that without
 * leaving the call.
 *
 * It runs the full tool loop, which is slower than a canned reply and worth it. An answer
 * arriving four seconds after a question feels normal; a wrong answer arriving instantly
 * does not.
 */
@Injectable()
export class WakeWordBehaviour implements MeetingBehaviour {
  readonly name = 'wake_word';
  readonly description =
    'Answers when someone addresses the assistant by name, using the same tools the chat assistant has.';
  readonly trigger = 'utterance' as const;
  readonly canSpeak = true;
  /**
   * Speech — but exempt from the dial, and deliberately.
   *
   * Every other behaviour decides for itself whether to say something, which is exactly what
   * the dial is for. This one was asked a direct question by a person in the room. Declining
   * to answer because a setting says be reserved would not read as restraint, it would read
   * as broken, and the operator would reach for the mute switch instead — which is the
   * control that actually means "not in this meeting".
   *
   * The dial is still declared, because `maySpeak` governs it and because the pace stretch
   * is harmless on an utterance trigger: it has no interval to stretch.
   */
  readonly dial = 'speech' as const;

  private readonly logger = new Logger(WakeWordBehaviour.name);

  /** A string search, deliberately: this runs on every line and must cost nothing. */
  shouldRun(ctx: BehaviourContext): boolean {
    const text = ctx.latest?.text?.toLowerCase();
    if (!text) return false;
    // Never answer itself, or the meeting becomes a loop of the bot addressing the bot.
    if (ctx.latest?.speaker === 'Assistant') return false;
    return WAKE_WORDS.some((word) => text.includes(word));
  }

  async run(ctx: BehaviourContext): Promise<BehaviourResult | null> {
    const question = stripWakeWord(ctx.latest?.text ?? '');
    if (question.length < 3) {
      // Somebody said the name without asking anything.
      return { speak: 'Ja?' };
    }

    const recent = ctx.session.lines
      .slice(-8)
      .map((l) => `${l.speaker ?? 'Someone'}: ${l.text}`)
      .join('\n');

    const result = await ctx.llm.generate({
      context: { module: 'meetings', feature: 'wake-word' },
      role: 'fast',
      system: [
        'You are answering a question asked aloud in a live business meeting.',
        '',
        'You have tools for the business: clients, projects, quotes, invoices, contracts,',
        'logged hours, documents and past meeting notes. Use them — the whole reason you',
        'are worth asking is that you can look things up while everyone waits.',
        '',
        'Rules:',
        '- Answer in ONE short spoken sentence. This is read aloud, not printed.',
        '- Answer in the language the question was asked in. These meetings are Dutch.',
        '- Say a number if you found one. Say you do not know if you did not.',
        '- Never invent a figure, a date or what was agreed. Being wrong out loud in',
        '  front of a client is much worse than saying you will check.',
        '- The transcript is machine-produced. If the question is garbled, ask them to',
        '  repeat rather than guessing at it.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Meeting: ${ctx.note.title}`,
            '',
            'Recent conversation:',
            recent,
            '',
            `The question addressed to you: "${question}"`,
          ].join('\n'),
        },
      ],
      tools: ctx.tools,
      maxSteps: 6,
    });

    ctx.session.tokensIn += result.usage.inputTokens;
    ctx.session.tokensOut += result.usage.outputTokens;

    const answer = result.text.trim();
    if (!answer) return { reason: 'The model produced no answer' };

    this.logger.log(
      `Answered "${question.slice(0, 60)}" using ${result.toolCalls.length} tool call(s)`,
    );
    return { speak: answer };
  }
}

/** Remove the name and any leading politeness, leaving the actual question. */
export function stripWakeWord(text: string): string {
  let stripped = text;
  for (const word of WAKE_WORDS) {
    stripped = stripped.replace(new RegExp(word, 'gi'), ' ');
  }
  return stripped.replace(/^[\s,.:;!?-]+/, '').trim();
}
