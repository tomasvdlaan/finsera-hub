import { Injectable, Logger } from '@nestjs/common';
import { AgendaDriftBehaviour } from './agenda-drift.behaviour.js';
import { NoteTakerBehaviour } from './note-taker.behaviour.js';
import { WakeWordBehaviour } from './wake-word.behaviour.js';
import type { BehaviourContext, BehaviourResult, MeetingBehaviour } from './behaviour.js';

/** What the operator has switched on for one meeting. */
export interface BehaviourSettings {
  enabled: Set<string>;
  /** Whether any behaviour may speak. A master switch above the per-behaviour one. */
  maySpeak: boolean;
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
  ) {
    this.behaviours = [wakeWord, agendaDrift, noteTaker];
  }

  /** For the UI and the platform documentation page. */
  list(): Array<{
    name: string;
    description: string;
    trigger: string;
    canSpeak: boolean;
    intervalMs?: number;
  }> {
    return this.behaviours.map((b) => ({
      name: b.name,
      description: b.description,
      trigger: b.trigger,
      canSpeak: b.canSpeak,
      intervalMs: b.intervalMs,
    }));
  }

  defaults(): BehaviourSettings {
    // Both on, speaking off. The agent watches from the first meeting and stays quiet
    // until someone decides otherwise.
    return { enabled: new Set(this.behaviours.map((b) => b.name)), maySpeak: false };
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
      if (!this.due(ctx.note.id, behaviour)) continue;

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

  private due(noteId: string, behaviour: MeetingBehaviour): boolean {
    if (behaviour.trigger !== 'interval' || !behaviour.intervalMs) return true;
    const last = this.lastRun.get(`${noteId}:${behaviour.name}`) ?? 0;
    return Date.now() - last >= behaviour.intervalMs;
  }

  forget(noteId: string): void {
    for (const key of [...this.lastRun.keys()]) {
      if (key.startsWith(`${noteId}:`)) this.lastRun.delete(key);
    }
  }
}
