/**
 * What each provider charges, and the arithmetic that turns usage into money.
 *
 * ## Why a rate card rather than the provider's own billing API
 *
 * Anthropic, Google and Recall all publish what you were actually charged, and that is the
 * exact number — but only as a daily total per account, with no way back to *which* part of
 * the platform spent it. The question this exists to answer is "the assistant costs us what,
 * against meetings costing us what", and no invoice endpoint can answer that. So the platform
 * meters its own calls and prices them here.
 *
 * The consequence, stated plainly because it will show up: **these are estimates.** They drift
 * from the invoice when a provider changes prices before this file is updated, and when a
 * discount applies that the rate card knows nothing about. Expect single-digit-percent error,
 * treat the trend and the split as reliable, and treat the absolute total as indicative.
 *
 * ## Prices are per million tokens, in euros
 *
 * Providers quote dollars; these are euros at roughly 0.92, because the invoice that matters
 * arrives in euros. Every rate is overridable by environment variable so a price change does
 * not need a deploy — and the defaults are dated so a stale card is visible rather than
 * assumed current.
 *
 * Rates verified against published pricing on 2026-08-28.
 */

/** One euro, in the millionths this module counts in. */
export const MICROS_PER_EURO = 1_000_000;

/** Read a rate override, falling back to the dated default. */
const rate = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  // A typo in an env var must not silently price everything at zero.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Euros per million tokens, by model.
 *
 * Keyed on the model string the call actually used, so a model swap shows up as an unpriced
 * model rather than as the old model's price quietly applied to the new one.
 */
export interface TokenRate {
  input: number;
  output: number;
  /** Cached input, billed at a fraction of fresh input. */
  cacheRead: number;
  /** Writing to the cache, billed at a premium over fresh input, once. */
  cacheWrite: number;
}

const ANTHROPIC_SONNET: TokenRate = {
  input: rate('RATE_SONNET_IN', 2.76),
  output: rate('RATE_SONNET_OUT', 13.8),
  cacheRead: rate('RATE_SONNET_CACHE_READ', 0.276),
  cacheWrite: rate('RATE_SONNET_CACHE_WRITE', 3.45),
};

const ANTHROPIC_HAIKU: TokenRate = {
  input: rate('RATE_HAIKU_IN', 0.92),
  output: rate('RATE_HAIKU_OUT', 4.6),
  cacheRead: rate('RATE_HAIKU_CACHE_READ', 0.092),
  cacheWrite: rate('RATE_HAIKU_CACHE_WRITE', 1.15),
};

const GOOGLE_FLASH: TokenRate = {
  input: rate('RATE_FLASH_IN', 0.276),
  output: rate('RATE_FLASH_OUT', 2.3),
  cacheRead: rate('RATE_FLASH_CACHE_READ', 0.069),
  cacheWrite: rate('RATE_FLASH_CACHE_WRITE', 0.345),
};

/**
 * Gemini Pro, which is what MODEL_STRONG actually resolves to on this instance.
 *
 * Kept distinct from Flash because the gap is about fourfold, and a generic `gemini` entry
 * priced every assistant answer at Flash rates — the single largest source of error this page
 * could have had, since the assistant is the biggest spender and every one of its calls is a
 * Pro call. Found by metering a real question and reading the row back.
 */
const GOOGLE_PRO: TokenRate = {
  input: rate('RATE_GEMINI_PRO_IN', 1.15),
  output: rate('RATE_GEMINI_PRO_OUT', 9.2),
  cacheRead: rate('RATE_GEMINI_PRO_CACHE_READ', 0.115),
  cacheWrite: rate('RATE_GEMINI_PRO_CACHE_WRITE', 1.44),
};

/**
 * Flash Lite, which is what MODEL_FAST resolves to on this instance.
 *
 * Roughly a third of Flash. Without its own entry it matched the `gemini`+`flash` rule and was
 * over-priced — the opposite error to the Pro one, and just as invisible on a page of bars.
 */
const GOOGLE_FLASH_LITE: TokenRate = {
  input: rate('RATE_FLASH_LITE_IN', 0.092),
  output: rate('RATE_FLASH_LITE_OUT', 0.368),
  cacheRead: rate('RATE_FLASH_LITE_CACHE_READ', 0.023),
  cacheWrite: rate('RATE_FLASH_LITE_CACHE_WRITE', 0.115),
};

const GOOGLE_EMBEDDING: TokenRate = {
  input: rate('RATE_EMBEDDING_IN', 0.138),
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * Model string → rate.
 *
 * Matched on the substrings that identify a *family*, not on a prefix, because the part that
 * distinguishes a price sits after the part that varies: `gemini-3.1-pro-preview` and
 * `gemini-2.5-flash` share a prefix and differ fourfold in cost. Every listed substring must
 * appear; the entry matching the most characters wins, so `gemini`+`pro` beats bare `gemini`.
 *
 * Dated suffixes (`claude-sonnet-4-5-20250929`) are ignored for free by the same mechanism.
 */
const CARD: Array<{ match: string[]; rate: TokenRate }> = [
  { match: ['claude', 'haiku'], rate: ANTHROPIC_HAIKU },
  { match: ['claude', 'sonnet'], rate: ANTHROPIC_SONNET },
  { match: ['claude', 'opus'], rate: ANTHROPIC_SONNET },
  { match: ['embedding'], rate: GOOGLE_EMBEDDING },
  { match: ['gemini', 'pro'], rate: GOOGLE_PRO },
  { match: ['gemini', 'flash', 'lite'], rate: GOOGLE_FLASH_LITE },
  { match: ['gemini', 'flash'], rate: GOOGLE_FLASH },
  // Bare fallback for a Gemini that names neither tier. Flash rather than Pro because it is
  // the cheaper of the two, and a cost page that under-reports is at least not crying wolf —
  // the unpriced-model warning in the log is what actually gets this fixed.
  { match: ['gemini'], rate: GOOGLE_FLASH },
];

/** The rate for a model, or null when the card has never heard of it. */
export function rateFor(model: string): TokenRate | null {
  const id = (model.includes(':') ? model.slice(model.indexOf(':') + 1) : model).toLowerCase();
  const matches = CARD.filter((entry) => entry.match.every((part) => id.includes(part)));
  if (matches.length === 0) return null;
  // The most specific entry wins, measured by how much of the name it accounts for.
  const weight = (e: { match: string[] }) => e.match.join('').length;
  return matches.reduce((a, b) => (weight(b) > weight(a) ? b : a)).rate;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Tokens to micro-euros.
 *
 * Returns null for a model the card cannot price, and the caller records the event with a zero
 * cost rather than dropping it. A row with tokens and no price is a visible gap — an absent row
 * is an invisible one, and the whole point of this page is to notice spending.
 *
 * Fresh input excludes cached reads: the vendors bill `input_tokens` as the uncached remainder,
 * and adding the two would charge full price for tokens already discounted below.
 */
export function costMicrosFor(model: string, counts: TokenCounts): number | null {
  const r = rateFor(model);
  if (!r) return null;
  const perToken = (millions: number, euros: number) => (millions / 1_000_000) * euros * MICROS_PER_EURO;
  return Math.round(
    perToken(counts.inputTokens, r.input) +
      perToken(counts.outputTokens, r.output) +
      perToken(counts.cacheReadTokens, r.cacheRead) +
      perToken(counts.cacheWriteTokens, r.cacheWrite),
  );
}

/**
 * A Recall bot, billed by wall-clock hour rather than by anything it produced.
 *
 * This is the cost most likely to surprise: a bot left in an empty room bills exactly like a
 * bot in a meeting, and there is no token count to make that visible. Metering by duration is
 * what turns "the AI is expensive" into "a bot ran for six hours on Tuesday".
 */
export const RECALL_EUROS_PER_HOUR = rate('RATE_RECALL_PER_HOUR', 0.69);

export function recallCostMicros(seconds: number): number {
  return Math.round((seconds / 3600) * RECALL_EUROS_PER_HOUR * MICROS_PER_EURO);
}

/**
 * Text-to-speech, billed per character by Google.
 *
 * Local speech (`say`) costs nothing and is recorded with a zero — kept as a row rather than
 * skipped, so the page can show that the cheap path is being taken rather than showing silence
 * that looks identical to the feature being unused.
 */
export const TTS_EUROS_PER_MILLION_CHARS = rate('RATE_TTS_PER_MILLION_CHARS', 14.72);

export function ttsCostMicros(characters: number): number {
  return Math.round((characters / 1_000_000) * TTS_EUROS_PER_MILLION_CHARS * MICROS_PER_EURO);
}
