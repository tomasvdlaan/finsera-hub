import { Injectable, Logger } from '@nestjs/common';
import { AgendaDriftBehaviour } from './agenda-drift.behaviour.js';
import { ContextFinderBehaviour } from './context-finder.behaviour.js';
import { NoteTakerBehaviour } from './note-taker.behaviour.js';
import { WakeWordBehaviour } from './wake-word.behaviour.js';
import { DEFAULT_EAGERNESS, pace, type Eagerness } from '../eagerness.js';
import type { BehaviourContext, BehaviourResult, MeetingBehaviour } from './behaviour.js';

/** What the operator has switched on for one meeting. */
export interface BehaviourSettings {
  enabled: Set<string>;
  /**
   * Whether any behaviour may speak. A master switch above the per-behaviour one.
   *
   * Kept distinct from `eagerness.speech`, which is a different question: this is whether the
   * agent has a voice in this meeting at all, and that is about the room — who is in it, and
   * whether a client would be surprised. The dial is about how much it has to say once it
   * does. Folding them into one control would mean the only way to quieten a talkative agent
   * was to mute it, and the only way to hear from it at all was to accept every remark.
   */
  maySpeak: boolean;
  /** How forward to be, per kind of consequence. See eagerness.ts. */
  eagerness: Eagerness;
}

/**
 * Everything the meeting agent knows how to do.
 *
 * Adding a behaviour means writing one class and listing it here. The runner is not
 * touched, and neither is anything to do with audio, transcription or cost — which is
 * the whole point of the split: the loop that runs a meeting should not accumulate
 * opinions about what the agent is for.
 */
@Injectable()
export class BehaviourRegistry {
  private readonly logger = new Logger(BehaviourRegistry.name);
  private readonly behaviours: MeetingBehaviour[];
  /** Last run per meeting per behaviour, for the interval-triggered ones. */
  private readonly lastRun = new Map<string, number>();

  constructor(
    wakeWord: WakeWordBehaviour,
    agendaDrift: AgendaDriftBehaviour,
    noteTaker: NoteTakerBehaviour,
    contextFinder: ContextFinderBehaviour,
  ) {
    this.behaviours = [wakeWord, agendaDrift, noteTaker, contextFinder];
  }

  /** For the UI and the platform documentation page. */
  list(): Array<{
    name: string;
    description: string;
    trigger: string;
    canSpeak: boolean;
    intervalMs?: number;
    dial: string;
  }> {
    return this.behaviours.map((b) => ({
      name: b.name,
      description: b.description,
      trigger: b.trigger,
      canSpeak: b.canSpeak,
      intervalMs: b.intervalMs,
      // So the panel can show each behaviour under the dial that governs it, rather than
      // leaving the reader to guess which of the three controls affects which line.
      dial: b.dial,
    }));
  }

  defaults(eagerness: Eagerness = DEFAULT_EAGERNESS): BehaviourSettings {
    // All on, speaking off. The agent watches from the first meeting and stays quiet
    // until someone decides otherwise.
    return { enabled: new Set(this.behaviours.map((b) => b.name)), maySpeak: false, eagerness };
  }

  /**
   * Run whatever is due.
   *
   * A behaviour that throws is logged and skipped: one broken behaviour must not stop
   * the others, and none of them may take the meeting down.
   */
  async run(
    trigger: 'utterance' | 'interval',
    ctx: BehaviourContext,
    settings: BehaviourSettings,
  ): Promise<BehaviourResult[]> {
    const results: BehaviourResult[] = [];

    for (const behaviour of this.behaviours) {
      if (behaviour.trigger !== trigger) continue;
      if (!settings.enabled.has(behaviour.name)) continue;
      if (!this.due(ctx.note.id, behaviour, settings.eagerness)) continue;

      let shouldRun: boolean;
      try {
        shouldRun = behaviour.shouldRun(ctx);
      } catch (error) {
        this.logger.warn(`${behaviour.name}.shouldRun failed: ${(error as Error).message}`);
        continue;
      }
      if (!shouldRun) continue;

      this.lastRun.set(`${ctx.note.id}:${behaviour.name}`, Date.now());

      try {
        const result = await behaviour.run(ctx);
        if (!result) continue;
        // The per-behaviour permission and the meeting-wide switch must both allow it.
        if (result.speak && !(behaviour.canSpeak && settings.maySpeak)) {
          results.push({ ...result, speak: undefined });
        } else {
          results.push(result);
        }
      } catch (error) {
        this.logger.warn(`${behaviour.name} failed: ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Whether an interval behaviour is due, stretched by its dial.
   *
   * The dial reaches the schedule and not only the prompt, deliberately. An agent told to be
   * reserved and then asked the same question every ninety seconds is not reserved, it is
   * repeatedly declining — at full price, since a pass that concludes nothing costs what a
   * pass that concludes something costs.
   */
  private due(noteId: string, behaviour: MeetingBehaviour, eagerness: Eagerness): boolean {
    if (behaviour.trigger !== 'interval' || !behaviour.intervalMs) return true;
    const last = this.lastRun.get(`${noteId}:${behaviour.name}`) ?? 0;
    return Date.now() - last >= pace(eagerness[behaviour.dial], behaviour.intervalMs);
  }

  forget(noteId: string): void {
    for (const key of [...this.lastRun.keys()]) {
      if (key.startsWith(`${noteId}:`)) this.lastRun.delete(key);
    }
    /*
     * And anything a behaviour remembers itself.
     *
     * Asked of all of them rather than of one by name. Reaching into a specific behaviour
     * would make the registry — which exists so that adding a behaviour touches nothing else
     * — the one place that has to change every time a behaviour starts keeping state.
     */
    for (const behaviour of this.behaviours) behaviour.forget?.(noteId);
  }
}
