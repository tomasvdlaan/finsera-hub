/**
 * Ask OpenRouter what a call actually cost, and carry the answer back.
 *
 * ## Why this is worth the two hooks
 *
 * Everything else on the costs page is priced by this platform from a rate card — an estimate,
 * and one that was wrong twice on the day it was written: Gemini Pro under by fourfold, Flash
 * Lite over by threefold, both invisible until a real row was read back. A gateway call does
 * not need estimating. OpenRouter returns what it charged, in the same response as the answer.
 *
 * Two hooks the provider already exposes do the whole job:
 *
 *   `transformRequestBody` adds `usage: { include: true }`, which is what asks for the figure.
 *   `metadataExtractor` lifts it out of the response and into `providerMetadata.openrouter`.
 *
 * The shape, confirmed against a real call rather than from documentation:
 *
 *   "usage": {
 *     "prompt_tokens": 6, "completion_tokens": 5,
 *     "cost": 0.0000066879,
 *     "prompt_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 }
 *   }
 *
 * `cost` is US dollars. Everything downstream counts in micro-euros, so the conversion happens
 * here, once, rather than at each of the four call sites.
 */

/**
 * The SDK's metadata shape, declared structurally rather than imported.
 *
 * `@ai-sdk/provider` is a transitive dependency of the provider packages, not a direct one here,
 * and importing from it would pin this file to a package the workspace does not manage.
 */
type ProviderMetadata = Record<string, Record<string, unknown>>;

/** USD → EUR. The same knob the rate card uses, so the two agree. */
const usdToEur = () => Number(process.env.RATE_USD_PER_EUR ?? 0.92);

/** Dollars to millionths of a euro. */
export const usdToMicros = (usd: number): number => Math.round(usd * usdToEur() * 1_000_000);

interface OpenRouterUsage {
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

/** Pull the usage block out of whatever shape arrived, without trusting any of it. */
function usageOf(body: unknown): OpenRouterUsage | null {
  if (!body || typeof body !== 'object') return null;
  const usage = (body as { usage?: unknown }).usage;
  return usage && typeof usage === 'object' ? (usage as OpenRouterUsage) : null;
}

/**
 * The metadata this platform wants off an OpenRouter response.
 *
 * `costMicros` is the point. The two cache figures come along because OpenRouter reports them in
 * a different place from the OpenAI-compatible fields the SDK reads, so without this they arrive
 * as zero and a cached conversation looks uncached on the page.
 */
export interface OpenRouterMetadata {
  costMicros?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function toMetadata(body: unknown): ProviderMetadata | undefined {
  const usage = usageOf(body);
  if (!usage) return undefined;

  const meta: OpenRouterMetadata = {};
  // `typeof` rather than truthiness: a genuinely free call costs 0, which is a real answer and
  // must not be discarded as though the field were missing.
  if (typeof usage.cost === 'number') meta.costMicros = usdToMicros(usage.cost);
  const details = usage.prompt_tokens_details;
  if (typeof details?.cached_tokens === 'number') meta.cacheReadTokens = details.cached_tokens;
  if (typeof details?.cache_write_tokens === 'number') {
    meta.cacheWriteTokens = details.cache_write_tokens;
  }

  return Object.keys(meta).length > 0 ? { openrouter: meta as Record<string, unknown> } : undefined;
}

/**
 * The extractor, for both response shapes.
 *
 * A streamed answer carries its usage on the last chunk, so the stream extractor keeps the most
 * recent one it saw rather than the first: an early chunk can contain a partial usage block, and
 * taking that would report the cost of the first few tokens as the cost of the answer.
 */
export const openRouterMetadataExtractor = {
  extractMetadata: async ({ parsedBody }: { parsedBody: unknown }) => toMetadata(parsedBody),

  createStreamExtractor: () => {
    let latest: unknown = null;
    return {
      processChunk(parsedChunk: unknown) {
        if (usageOf(parsedChunk)) latest = parsedChunk;
      },
      buildMetadata() {
        return latest ? toMetadata(latest) : undefined;
      },
    };
  },
};

/** Read this platform's metadata back off a result, whatever the SDK wrapped it in. */
export function openRouterMetadataOf(meta: unknown): OpenRouterMetadata | null {
  if (!meta || typeof meta !== 'object') return null;
  const own = (meta as Record<string, unknown>).openrouter;
  return own && typeof own === 'object' ? (own as OpenRouterMetadata) : null;
}
