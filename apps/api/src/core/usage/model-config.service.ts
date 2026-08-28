import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Database } from '../db/db.module.js';
import { platformSettings } from '../db/core.schema.js';
import { availableModels, isSelectable, type ModelChoice } from './models.js';
import { OpenRouterService } from './openrouter.service.js';

export interface ModelSelection {
  strong: string;
  fast: string;
  /** True where the value came from the environment rather than from somebody's choice. */
  strongFromEnv: boolean;
  fastFromEnv: boolean;
}

/** The environment's answer, which is the default and the fallback. */
const envStrong = () => process.env.MODEL_STRONG ?? 'anthropic:claude-opus-4-8';
const envFast = () => process.env.MODEL_FAST ?? 'anthropic:claude-haiku-4-5-20251001';

/**
 * Which model answers, as a setting rather than a redeploy.
 *
 * ## The cache, and why it is not optional
 *
 * `LlmService` resolves a model on every single call, including every step of a tool-calling
 * answer. Reading a table there would put a database round trip in front of work that is
 * already the slowest thing the platform does — harmless individually, and silly at eight
 * steps a question.
 *
 * So the row is cached in memory and the cache is written through on every change, which makes
 * it exact on a single instance. The TTL exists only for the two-instance case: without it, an
 * administrator changing the model on one instance would never reach the other until a restart,
 * and "it worked when I tried it" is the worst possible shape for a configuration bug.
 */
const CACHE_TTL_MS = 60_000;

@Injectable()
export class ModelConfigService {
  private readonly logger = new Logger(ModelConfigService.name);
  private cached: { at: number; row: { modelStrong: string | null; modelFast: string | null } } | null =
    null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly openrouter: OpenRouterService,
  ) {}

  /**
   * The stored row, or nulls.
   *
   * A read failure falls back to "nothing is set" rather than throwing: the environment
   * variables are a complete answer on their own, and a database hiccup must not take the
   * assistant down with it.
   */
  private async row(): Promise<{ modelStrong: string | null; modelFast: string | null }> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.row;
    try {
      const [found] = await this.db.select().from(platformSettings).limit(1);
      const row = { modelStrong: found?.modelStrong ?? null, modelFast: found?.modelFast ?? null };
      this.cached = { at: Date.now(), row };
      return row;
    } catch (err) {
      this.logger.warn(`Could not read model settings (${(err as Error).message}); using the environment`);
      return { modelStrong: null, modelFast: null };
    }
  }

  /** What should answer right now, for one slot. */
  async specFor(role: 'strong' | 'fast'): Promise<string> {
    const row = await this.row();
    const chosen = role === 'strong' ? row.modelStrong : row.modelFast;
    /*
     * A stored model that is no longer selectable is ignored, not obeyed.
     *
     * The list is code and the keys are environment: either can change under a stored value,
     * leaving a row that names a model this deployment cannot reach. Falling back to the
     * environment keeps the platform answering; obeying the row would break every AI feature
     * until somebody opened this screen, and nothing would say why.
     */
    if (chosen && this.usable(chosen, role)) return chosen;
    if (chosen) {
      this.logger.warn(`Stored ${role} model '${chosen}' is not selectable here; using the environment`);
    }
    return role === 'strong' ? envStrong() : envFast();
  }

  /**
   * Whether a stored id is one this deployment can still reach.
   *
   * OpenRouter ids are judged on the key alone rather than against its catalogue, deliberately:
   * this runs on the hot path of every LLM call, and it must not depend on a network fetch
   * having succeeded. A gateway id that OpenRouter no longer serves fails at the call with the
   * gateway's own message, which is a clearer answer than this one silently swapping the model.
   */
  private usable(id: string, role: 'strong' | 'fast'): boolean {
    if (id.startsWith('openrouter:')) return OpenRouterService.configured();
    return isSelectable(id, role);
  }

  /** Both slots plus where each answer came from — what the settings screen renders. */
  async current(): Promise<ModelSelection> {
    const row = await this.row();
    const usable = (v: string | null, role: 'strong' | 'fast') => Boolean(v && this.usable(v, role));
    return {
      strong: await this.specFor('strong'),
      fast: await this.specFor('fast'),
      strongFromEnv: !usable(row.modelStrong, 'strong'),
      fastFromEnv: !usable(row.modelFast, 'fast'),
    };
  }

  /**
   * The catalogue this deployment can offer.
   *
   * Direct models first and the gateway's after, because the direct route is the one that does
   * not hand a prompt to a third party — the ordering is the recommendation.
   */
  async options(): Promise<{ strong: ModelChoice[]; fast: ModelChoice[] }> {
    const viaGateway = OpenRouterService.configured() ? await this.openrouter.choices() : [];
    return {
      strong: [...availableModels('strong'), ...viaGateway],
      fast: [...availableModels('fast'), ...viaGateway],
    };
  }

  /**
   * Choose a model, or pass null to hand the slot back to the environment.
   *
   * Validated against the same list the screen was built from, because the screen is not the
   * only way to reach this — and an unvalidated string here would let somebody set a model
   * whose provider has no key, breaking every AI feature with a successful-looking save.
   */
  async set(role: 'strong' | 'fast', id: string | null): Promise<ModelSelection> {
    const allowed =
      id === null ||
      (id.startsWith('openrouter:')
        ? // Checked against the live catalogue here, unlike on the hot path: a save is rare,
          // and refusing a model that does not exist is the whole job of this validation.
          await this.openrouter.isSelectable(id)
        : isSelectable(id, role));
    if (!allowed) {
      throw new BadRequestException(`'${id}' is not a model this platform can use for ${role} work`);
    }

    const patch = role === 'strong' ? { modelStrong: id } : { modelFast: id };
    await this.db
      .insert(platformSettings)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: platformSettings.id, set: { ...patch, updatedAt: new Date() } });

    // Written through rather than invalidated: the next call happens immediately, and a reader
    // that had to wait out the TTL would make the change look as though it had not saved.
    this.cached = null;
    await this.row();

    this.logger.log(`${role} model set to ${id ?? 'the environment default'}`);
    return this.current();
  }

  /** Clear the cache. Tests only — a service that changes the row behind this one's back. */
  forget(): void {
    this.cached = null;
  }
}

/** Re-exported so callers do not reach past this service into the catalogue. */
export { availableModels, type ModelChoice } from './models.js';

/** The environment's answer, exposed for the diagnostics route. */
export const environmentModels = () => ({ strong: envStrong(), fast: envFast() });
