import { describe, expect, it } from 'vitest';
import { costMicrosFor, rateFor, recallCostMicros, ttsCostMicros, MICROS_PER_EURO } from './rates.js';

/**
 * Pricing, which is the part of this feature that can be wrong without looking wrong.
 *
 * A cost page that renders beautifully and reports half the real spend is worse than no page,
 * because the number gets believed and then quoted. These tests pin the arithmetic and the two
 * places it is easy to get subtly wrong: cached tokens, and rounding a fraction of a cent.
 */
describe('rate card', () => {
  it('matches a model by prefix, ignoring the dated suffix', () => {
    // Model ids carry a release date that changes without the price changing.
    expect(rateFor('claude-haiku-4-5-20251001')).toEqual(rateFor('claude-haiku-9-9-20991231'));
  });

  it('strips a provider prefix before matching', () => {
    expect(rateFor('anthropic:claude-sonnet-4-5')).toEqual(rateFor('claude-sonnet-4-5'));
  });

  it('tells Gemini Pro from Gemini Flash', () => {
    // The version sits between the two words that decide the price, so a prefix match cannot
    // separate them — and getting this wrong under-priced every assistant answer fourfold.
    const pro = rateFor('google:gemini-3.1-pro-preview')!;
    const flash = rateFor('google:gemini-3.7-flash')!;
    expect(pro.input).toBeGreaterThan(flash.input * 3);
  });

  it('tells Flash Lite from Flash', () => {
    // 'flash-lite' matches the flash rule too; the more specific entry must win, or the
    // cheapest model on the platform is billed at three times its rate.
    expect(rateFor('gemini-3.1-flash-lite')!.input).toBeLessThan(rateFor('gemini-3.7-flash')!.input);
  });

  it('prices an embedding model as an embedding, not as a Gemini generation', () => {
    // 'gemini-embedding-001' matches the bare gemini entry too; the specific one must win.
    expect(rateFor('gemini-embedding-001')!.output).toBe(0);
  });

  it('prefers the longest matching prefix', () => {
    // 'claude-haiku' and a hypothetical 'claude' both match; the specific one must win, or
    // every cheap call is priced as an expensive one.
    const haiku = rateFor('claude-haiku-4-5')!;
    const sonnet = rateFor('claude-sonnet-4-5')!;
    expect(haiku.input).toBeLessThan(sonnet.input);
  });

  it('returns null for a model it has never heard of', () => {
    // Null rather than a guessed default: an unpriced model must be visible as unpriced.
    expect(rateFor('llama-3-70b')).toBeNull();
  });
});

describe('cost arithmetic', () => {
  it('prices a million input tokens at exactly the quoted rate', () => {
    const micros = costMicrosFor('claude-sonnet-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(micros).toBe(Math.round(2.76 * MICROS_PER_EURO));
  });

  it('charges cached reads at a fraction of fresh input', () => {
    const counts = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
    const cached = costMicrosFor('claude-sonnet-4-5', { ...counts, cacheReadTokens: 1_000_000 })!;
    const fresh = costMicrosFor('claude-sonnet-4-5', {
      ...counts,
      cacheReadTokens: 0,
      inputTokens: 1_000_000,
    })!;
    // The whole reason the prompt cache exists. If these were equal, the page would report no
    // benefit from caching and the caching work would look pointless.
    expect(cached).toBeLessThan(fresh / 5);
  });

  it('keeps a fraction of a cent rather than rounding it to nothing', () => {
    // One embedding call, ~1000 tokens. In an integer-cents column this is 0, and a thousand
    // of them are also 0 — which is exactly the spend this page exists to make visible.
    const micros = costMicrosFor('gemini-embedding-001', {
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })!;
    expect(micros).toBeGreaterThan(0);
    // And it is genuinely tiny: well under a tenth of a cent.
    expect(micros).toBeLessThan(MICROS_PER_EURO / 1000);
  });

  it('returns null for an unpriced model rather than zero', () => {
    expect(
      costMicrosFor('llama-3-70b', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });
});

describe('the costs that are not tokens', () => {
  it('bills a Recall bot by the hour it sat in the room', () => {
    const hour = recallCostMicros(3600);
    expect(hour).toBe(Math.round(0.69 * MICROS_PER_EURO));
    // Half an hour is half the money — the linearity that makes "a bot ran for six hours"
    // a sentence somebody can act on.
    expect(recallCostMicros(1800)).toBe(Math.round(hour / 2));
  });

  it('bills speech per character', () => {
    expect(ttsCostMicros(1_000_000)).toBe(Math.round(14.72 * MICROS_PER_EURO));
    expect(ttsCostMicros(0)).toBe(0);
  });
});
