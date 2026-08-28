import { Injectable, Logger } from '@nestjs/common';
import { perAnswerMicros as answerCost, type TokenRate } from './rates.js';
import type { ModelChoice } from './models.js';

/**
 * OpenRouter: one key, several hundred models, and its own price list.
 *
 * ## What this buys, and what it costs
 *
 * The direct providers stay exactly as they were — `anthropic:` and `google:` still go straight
 * to the vendor, and nothing in this file touches them. This is an *additional* route, chosen
 * per model, for reaching everything else.
 *
 * It fixes the two weaknesses of the hand-maintained catalogue next door. Models are listed by
 * OpenRouter rather than typed in here, so an entry cannot go stale the way `gemini-2.5-flash`
 * did — it was in the list, it was in Google's own listing, and calling it returned "no longer
 * available to new users". And prices come from the same response, so an OpenRouter model is
 * priced from the source instead of from a card somebody has to remember to update.
 *
 * **The cost, stated plainly because it is a decision and not a detail: prompts routed this way
 * pass through a third party.** Anything with client-confidential material in it — a meeting
 * transcript, a contract, a client's figures — is being handed to a company that is not the
 * model vendor. That is a data-processing question rather than a technical one, and it is why
 * the direct providers remain the default and why nothing here changes what already runs.
 *
 * ## Only models that can call tools
 *
 * The assistant is a tool-calling agent — roughly forty tools, several steps per answer. A
 * model without tool support does not degrade gracefully here; it produces a confident answer
 * built from nothing, because it cannot look anything up. Of OpenRouter's models a little over
 * eight in ten support tools, and the rest are filtered out rather than offered and regretted.
 */
interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  supported_parameters?: string[];
  pricing?: {
    /** USD per token, as a string. '0' for a free tier. */
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

/** USD per token → EUR per million tokens, the unit the rest of the costing works in. */
const USD_PER_EUR = Number(process.env.RATE_USD_PER_EUR ?? 0.92);
const perMillionEuros = (usdPerToken: string | undefined): number => {
  const n = Number(usdPerToken ?? 0);
  return Number.isFinite(n) ? n * 1_000_000 * USD_PER_EUR : 0;
};

/**
 * How long the catalogue is trusted before it is fetched again.
 *
 * Six hours: models and prices change on the order of weeks, and the cost of being a few hours
 * stale is a price that is slightly wrong on a page that already says it is an estimate. The
 * cost of fetching per request would be a network call in front of every model dropdown.
 */
const CATALOGUE_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private cache: { at: number; models: OpenRouterModel[] } | null = null;
  /** In-flight fetch, so ten concurrent readers make one request rather than ten. */
  private inFlight: Promise<OpenRouterModel[]> | null = null;

  static configured(): boolean {
    // Truthiness, not `!== undefined`: an unused key sits in .env as an empty string.
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  /**
   * The catalogue, fetched at most every few hours.
   *
   * A failed fetch keeps serving the previous answer if there is one, and an empty list if
   * there is not. Neither throws: OpenRouter being unreachable must degrade the model picker,
   * not take down the costs page it lives on.
   *
   * The endpoint needs no key, which is why the list can be shown before one is configured —
   * though nothing can actually be selected until it is.
   */
  async models(): Promise<OpenRouterModel[]> {
    if (this.cache && Date.now() - this.cache.at < CATALOGUE_TTL_MS) return this.cache.models;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = (await res.json()) as { data?: OpenRouterModel[] };
        const models = body.data ?? [];
        this.cache = { at: Date.now(), models };
        this.logger.log(`OpenRouter catalogue: ${models.length} models`);
        return models;
      } catch (err) {
        this.logger.warn(`Could not read the OpenRouter catalogue (${(err as Error).message})`);
        return this.cache?.models ?? [];
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  /**
   * What may be chosen, as the picker's options.
   *
   * Both slots get the same list. There is no reliable way to tell from the catalogue which
   * models are quick enough for the live-meeting path — `context_length` and price are poor
   * proxies for latency — so rather than invent a distinction, the price is shown against every
   * option and the choice is left to somebody who can measure it.
   */
  async choices(): Promise<ModelChoice[]> {
    const models = await this.models();
    return models
      .filter((m) => (m.supported_parameters ?? []).includes('tools'))
      .map((m) => {
        const inEur = perMillionEuros(m.pricing?.prompt);
        const outEur = perMillionEuros(m.pricing?.completion);
        /*
         * A leading tilde marks a floating alias — `~anthropic/claude-haiku-latest` follows
         * whatever Anthropic ships next. Stripped for grouping so it sits with the vendor's
         * pinned models rather than forming a phantom company above them, and labelled,
         * because a model that changes under you is a different proposition from one that
         * does not: convenient for keeping current, useless for comparing behaviour.
         */
        const floating = m.id.startsWith('~');
        const vendor = (floating ? m.id.slice(1) : m.id).split('/')[0] ?? 'other';
        const price =
          inEur === 0 && outEur === 0
            ? 'Free tier — usually rate limited.'
            : `€${inEur.toFixed(2)} in / €${outEur.toFixed(2)} out per million tokens.`;
        return {
          id: `openrouter:${m.id}`,
          label: floating ? `${m.name} — auto-updating` : m.name,
          provider: 'openrouter' as const,
          roles: ['strong', 'fast'] as Array<'strong' | 'fast'>,
          // The price is the note, because it is the fact that differs most between options
          // and the reason somebody is on this page at all.
          note: floating ? `${price} Follows the vendor's newest release.` : price,
          perAnswerMicros:
            inEur === 0 && outEur === 0
              ? 0
              : answerCost({ input: inEur, output: outEur, cacheRead: 0, cacheWrite: 0 }),
          /** The company whose model this is, for grouping — 'anthropic/claude-…'. */
          group: vendor,
        };
      })
      /*
       * Vendor, then price ascending. Alphabetical within a vendor looked tidier and buried the
       * decision: the reason to open a list of a vendor's twenty models is to see what the cheap
       * end costs against the expensive end.
       */
      .sort(
        (a, b) =>
          (a.group ?? '').localeCompare(b.group ?? '') ||
          (a.perAnswerMicros ?? 0) - (b.perAnswerMicros ?? 0) ||
          a.label.localeCompare(b.label),
      );
  }

  /** Whether a full `openrouter:vendor/model` id is one this catalogue lists with tool support. */
  async isSelectable(fullId: string): Promise<boolean> {
    if (!OpenRouterService.configured()) return false;
    const choices = await this.choices();
    return choices.some((c) => c.id === fullId);
  }

  /**
   * The price of one model, in the same shape the static card returns.
   *
   * Reads the cached catalogue synchronously and returns null when it has not been fetched yet.
   * The caller records the call at zero in that case rather than dropping it, exactly as it does
   * for an unpriced model — a row with tokens and no price is a visible gap.
   */
  rateFor(fullId: string): TokenRate | null {
    if (!fullId.startsWith('openrouter:')) return null;
    const id = fullId.slice('openrouter:'.length);
    const model = this.cache?.models.find((m) => m.id === id);
    if (!model) return null;
    return {
      input: perMillionEuros(model.pricing?.prompt),
      output: perMillionEuros(model.pricing?.completion),
      cacheRead: perMillionEuros(model.pricing?.input_cache_read),
      cacheWrite: perMillionEuros(model.pricing?.input_cache_write),
    };
  }

  /**
   * What the account has left, straight from OpenRouter.
   *
   * Worth its own line on the page for two reasons, both of which happened while this was being
   * built. Running out is silent until it isn't: the first sign was every assistant answer
   * returning 402, with nothing on any screen to explain why.
   *
   * And it is the only figure that catches what the meter cannot see. A request that fails
   * *after* the model has answered is billed by OpenRouter and never recorded here — the SDK
   * throws before it returns any usage, so there is nothing to write down. Measured on three
   * calls, this platform recorded €0,003572 against OpenRouter's €0,006114; the difference was
   * one such failure. The per-call figures stay right, the total drifts low, and this is what
   * makes the drift visible instead of leaving it to an invoice.
   *
   * Returns null when there is no key or the call fails — the page then shows nothing rather
   * than a zero, because "no balance" and "could not ask" must not look identical.
   */
  async credits(): Promise<{ remainingUsd: number; usedUsd: number } | null> {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
      const bought = body.data?.total_credits ?? 0;
      const used = body.data?.total_usage ?? 0;
      return { remainingUsd: bought - used, usedUsd: used };
    } catch (err) {
      this.logger.warn(`Could not read the OpenRouter balance (${(err as Error).message})`);
      return null;
    }
  }

  /** Warm the cache so `rateFor` can answer without waiting. Called before pricing a call. */
  async warm(): Promise<void> {
    if (!this.cache) await this.models();
  }
}
