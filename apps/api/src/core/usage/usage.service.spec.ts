import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { usageEvents } from '../db/core.schema.js';
import { resetDb, testDb, truncate } from '../../test/db.js';
import { UsageService } from './usage.service.js';

describe('UsageService', () => {
  let service: UsageService;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.usage_events`);
    service = new UsageService(testDb);
  });

  it('records a priced call with its tokens intact', async () => {
    await service.recordTokens(
      'anthropic',
      'generate',
      'anthropic:claude-sonnet-4-5',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { module: 'assistant', feature: 'ask', actorId: null },
    );

    const [row] = await testDb.select().from(usageEvents);
    expect(row!.costMicros).toBe(2_760_000);
    expect(row!.inputTokens).toBe(1_000_000);
    expect(row!.module).toBe('assistant');
  });

  it('records an unpriced model at zero rather than dropping it', async () => {
    // The tokens must stay visible. A missing row is an invisible gap; a zero-cost row with
    // 50k tokens on it is a question somebody will ask.
    await service.recordTokens(
      'meta',
      'generate',
      'llama-3-70b',
      { inputTokens: 50_000 },
      { module: 'assistant' },
    );

    const [row] = await testDb.select().from(usageEvents);
    expect(row!.costMicros).toBe(0);
    expect(row!.inputTokens).toBe(50_000);
  });

  it('never fails the call it is measuring', async () => {
    // The money is already spent by the time this runs. A metering failure that threw would
    // turn a successful, paid-for generation into a failed request.
    const broken = new UsageService({
      insert: () => {
        throw new Error('database is on fire');
      },
    } as unknown as typeof testDb);

    await expect(
      broken.recordTokens('anthropic', 'generate', 'claude-haiku-4-5', { inputTokens: 10 }, { module: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('records a local voice at zero, as a row rather than a silence', async () => {
    await service.recordSpeech('local', 500, true, { module: 'meetings' });

    const [row] = await testDb.select().from(usageEvents);
    expect(row!.costMicros).toBe(0);
    expect(row!.provider).toBe('local');
    expect(row!.units).toBe(500);
    expect(row!.unitKind).toBe('characters');
  });

  it('bills a Recall bot for the time it sat in the room', async () => {
    await service.recordRecallBot(3600, { module: 'meetings' });

    const [row] = await testDb.select().from(usageEvents);
    expect(row!.costMicros).toBe(690_000);
    expect(row!.units).toBe(3600);
  });

  describe('summary', () => {
    beforeEach(async () => {
      const at = (day: number) => new Date(Date.UTC(2026, 7, day, 12));
      await testDb.insert(usageEvents).values([
        { id: crypto.randomUUID(), at: at(10), provider: 'anthropic', kind: 'generate', model: 'claude-sonnet-4-5', module: 'assistant', costMicros: 3_000_000, inputTokens: 100 },
        { id: crypto.randomUUID(), at: at(11), provider: 'anthropic', kind: 'generate', model: 'claude-haiku-4-5', module: 'meetings', costMicros: 1_000_000, inputTokens: 200 },
        { id: crypto.randomUUID(), at: at(11), provider: 'google', kind: 'embed', model: 'gemini-embedding-001', module: 'docs', costMicros: 500, inputTokens: 50 },
        // Outside the window on purpose — a period query that ignores its bounds is the
        // easiest possible bug and the hardest to notice, because the number just looks big.
        { id: crypto.randomUUID(), at: at(28), provider: 'anthropic', kind: 'generate', model: 'claude-sonnet-4-5', module: 'assistant', costMicros: 9_999_999, inputTokens: 1 },
      ]);
    });

    const window = () => [new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2026, 7, 20))] as const;

    it('totals only what falls inside the period', async () => {
      const [from, to] = window();
      const summary = await service.summary(from, to);

      expect(Number(summary.total.costMicros)).toBe(4_000_500);
      expect(summary.total.calls).toBe(3);
    });

    it('splits by provider, module and model, each summing to the total', async () => {
      const [from, to] = window();
      const summary = await service.summary(from, to);

      const sum = (rows: Array<{ costMicros: number }>) =>
        rows.reduce((n, r) => n + Number(r.costMicros), 0);

      // The property that matters on the page: a breakdown that does not add up to the
      // headline makes every number on the page suspect.
      expect(sum(summary.byProvider)).toBe(Number(summary.total.costMicros));
      expect(sum(summary.byModule)).toBe(Number(summary.total.costMicros));
      expect(sum(summary.byModel)).toBe(Number(summary.total.costMicros));
    });

    it('orders a breakdown by spend, biggest first', async () => {
      const [from, to] = window();
      const { byModule } = await service.summary(from, to);
      expect(byModule.map((r) => r.key)).toEqual(['assistant', 'meetings', 'docs']);
    });

    it('reports a daily series for the trend', async () => {
      const [from, to] = window();
      const { daily } = await service.summary(from, to);

      expect(daily).toHaveLength(2);
      expect(daily[0]!.day).toBe('2026-08-10');
      // The two calls on the 11th are one row, added together.
      expect(Number(daily[1]!.costMicros)).toBe(1_000_500);
    });

    it('returns zeroes, not nothing, for a period with no spend', async () => {
      // An empty period must render as "€0,00 over 0 calls" rather than crashing a page that
      // expected a row back.
      const summary = await service.summary(new Date('2020-01-01'), new Date('2020-02-01'));
      expect(Number(summary.total.costMicros)).toBe(0);
      expect(summary.total.calls).toBe(0);
      expect(summary.byModule).toEqual([]);
    });
  });
});
