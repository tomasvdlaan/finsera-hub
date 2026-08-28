import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, gte, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { usageEvents } from '../db/core.schema.js';
import { costMicrosFor, recallCostMicros, ttsCostMicros, type TokenCounts } from './rates.js';
import { OpenRouterService } from './openrouter.service.js';

/** Who spent this, and on whose behalf. Passed by the call site; nothing here can infer it. */
export interface UsageContext {
  /** The module that made the call — 'assistant', 'meetings', 'docs'. */
  module: string;
  /** Optional finer grain within the module: 'live-extraction', 'wake-word'. */
  feature?: string;
  /** Null for genuine background work, which is a meaningful answer rather than a missing one. */
  actorId?: string | null;
}

/**
 * The platform's own meter for what it spends at external providers.
 *
 * ## Why this exists rather than reading the invoices
 *
 * See the note in `rates.ts`: an invoice is exact and anonymous, and the useful question is
 * which part of the platform is spending. This trades a few percent of accuracy for an answer
 * to that question.
 *
 * ## Recording never fails a request
 *
 * Every `record` path swallows its own errors. Metering is bookkeeping about work that has
 * already happened and been paid for — losing a row costs a line on a report, while throwing
 * would fail a user's request *after* the money was spent, which is strictly worse than not
 * knowing. The failure is logged so a systematically broken meter is still discoverable.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly openrouter?: OpenRouterService,
  ) {}

  /**
   * A token-billed call: generation, structured output, embedding.
   *
   * `reported.costMicros` is what the provider says it charged, and it wins over anything this
   * platform would work out for itself. Only OpenRouter supplies it today — the direct vendors
   * bill by invoice and say nothing per call — so this is the one path on the page where the
   * number is the real one rather than a good estimate.
   */
  async recordTokens(
    provider: string,
    kind: string,
    model: string,
    counts: Partial<TokenCounts>,
    ctx: UsageContext,
    reported?: { costMicros?: number },
  ): Promise<void> {
    const full: TokenCounts = {
      inputTokens: counts.inputTokens ?? 0,
      outputTokens: counts.outputTokens ?? 0,
      cacheReadTokens: counts.cacheReadTokens ?? 0,
      cacheWriteTokens: counts.cacheWriteTokens ?? 0,
    };
    /*
     * Priced from the gateway's own list for an OpenRouter model, and from the static card for
     * a direct one. The gateway route is the more accurate of the two — the prices come from
     * the same response that lists the model, rather than from a card kept by hand — which is
     * one real advantage of routing through it.
     */
    const micros =
      // `typeof` rather than truthiness: a free model reports 0, which is an answer.
      typeof reported?.costMicros === 'number'
        ? reported.costMicros
        : model.startsWith('openrouter:')
          ? await this.openRouterMicros(model, full)
          : costMicrosFor(model, full);
    if (micros === null) {
      this.logger.warn(`No rate for model '${model}' — recording ${full.inputTokens} tokens at zero`);
    }
    await this.write({ provider, kind, model, ...full, costMicros: micros ?? 0 }, ctx);
  }

  /** OpenRouter's own price for a model, or null when the catalogue has not been read yet. */
  private async openRouterMicros(model: string, counts: TokenCounts): Promise<number | null> {
    if (!this.openrouter) return null;
    // Warmed rather than assumed: the first call after a restart would otherwise be unpriced.
    await this.openrouter.warm();
    const r = this.openrouter.rateFor(model);
    if (!r) return null;
    const per = (tokens: number, euros: number) => (tokens / 1_000_000) * euros * 1_000_000;
    return Math.round(
      per(counts.inputTokens, r.input) +
        per(counts.outputTokens, r.output) +
        per(counts.cacheReadTokens, r.cacheRead) +
        per(counts.cacheWriteTokens, r.cacheWrite),
    );
  }

  /** A Recall bot, billed for as long as it sat in the room. */
  async recordRecallBot(seconds: number, ctx: UsageContext): Promise<void> {
    await this.write(
      {
        provider: 'recall',
        kind: 'transcribe',
        model: 'recall-bot',
        units: seconds,
        unitKind: 'seconds',
        costMicros: recallCostMicros(seconds),
      },
      ctx,
    );
  }

  /** Speech, billed per character — or free, when the local voice answered. */
  async recordSpeech(model: string, characters: number, local: boolean, ctx: UsageContext): Promise<void> {
    await this.write(
      {
        provider: local ? 'local' : 'google',
        kind: 'speak',
        model,
        units: characters,
        unitKind: 'characters',
        costMicros: local ? 0 : ttsCostMicros(characters),
      },
      ctx,
    );
  }

  /** The single write, and the single place failure is swallowed. */
  private async write(row: Record<string, unknown>, ctx: UsageContext): Promise<void> {
    try {
      await this.db.insert(usageEvents).values({
        id: uuidv7(),
        module: ctx.module,
        feature: ctx.feature ?? null,
        actorId: ctx.actorId ?? null,
        ...row,
      } as typeof usageEvents.$inferInsert);
    } catch (err) {
      this.logger.warn(`Failed to record usage (${(err as Error).message})`);
    }
  }

  /**
   * What was spent in a period, grouped every way the page shows it.
   *
   * One method rather than four endpoints because the four answers are the same rows read four
   * ways, and issuing them together keeps them consistent — four separate queries straddling a
   * write would show a total that does not match its own breakdown.
   */
  async summary(from: Date, to: Date): Promise<UsageSummary> {
    const period = and(gte(usageEvents.at, from), lt(usageEvents.at, to));

    const totals = await this.db
      .select({
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        cacheReadTokens: sql<number>`coalesce(sum(${usageEvents.cacheReadTokens}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(period);

    // Typed as the union of the three groupable columns rather than one of them: they are
    // structurally identical text columns, but Drizzle brands each with its own name.
    type Groupable =
      | typeof usageEvents.module
      | typeof usageEvents.provider
      | typeof usageEvents.model;

    const by = async (column: Groupable) =>
      this.db
        .select({
          key: sql<string>`coalesce(${column}, 'unattributed')`,
          costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
          calls: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(period)
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`);

    const daily = await this.db
      .select({
        day: sql<string>`to_char(${usageEvents.at} at time zone 'Europe/Amsterdam', 'YYYY-MM-DD')`,
        costMicros: sql<number>`coalesce(sum(${usageEvents.costMicros}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(period)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return {
      total: totals[0] ?? { costMicros: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      byProvider: await by(usageEvents.provider),
      byModule: await by(usageEvents.module),
      byModel: await by(usageEvents.model),
      daily,
    };
  }
}

export interface UsageBreakdown {
  key: string;
  costMicros: number;
  calls: number;
}

export interface UsageSummary {
  total: {
    costMicros: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  byProvider: UsageBreakdown[];
  byModule: UsageBreakdown[];
  byModel: UsageBreakdown[];
  daily: Array<{ day: string; costMicros: number }>;
}
