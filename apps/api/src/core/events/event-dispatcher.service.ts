import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { eventDeliveries, eventSubscribers, events } from '../db/core.schema.js';
import { EventBus } from './event-bus.service.js';
import { EventHandlerRegistry, type EventContext } from './event-handler.registry.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 5_000;
/*
 * How far before boot a new subscriber's start point is set.
 *
 * The start is taken from the app's clock and compared with `events.created_at`, which is the
 * database's. A minute absorbs any skew between the two, at the cost of a new subscriber
 * possibly seeing the last minute before its deploy — harmless, where missing the first
 * minute after it would not be.
 */
const START_MARGIN_MS = 60_000;

/**
 * The delivery half of the event bus (Master §9) — in-process, DB-backed, no broker.
 *
 * Guarantees at-least-once delivery per subscriber, so HANDLERS MUST BE IDEMPOTENT.
 * A nudge after publish is the fast path; a 5s poll is the reliable one, catching
 * missed nudges, crashes mid-handler, and subscribers added after the fact.
 */
@Injectable()
export class EventDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventDispatcher.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  /** When this process came up; a subscriber first seen now starts listening from here. */
  private readonly bootedAt = new Date(Date.now() - START_MARGIN_MS);
  /** Subscriber key → the time it started listening. Loaded once per process. */
  private starts?: Map<string, Date>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bus: EventBus,
    private readonly manifests: ManifestRegistry,
    private readonly handlers: EventHandlerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.bus.registerListener(() => void this.drain());
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Process pending work until there is none. Serialized: a second caller returns
   * immediately rather than double-handling the same delivery rows.
   */
  async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.fanOut();
      await this.deliver();
    } catch (err) {
      this.logger.error(`Dispatch cycle failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * When each declared subscriber started listening, registering any seen for the first time.
   *
   * The row is written once and never moved, so a restart does not reset it: the start point
   * is the deploy that introduced the subscriber. A subscriber that declared `replay` starts
   * at the beginning of the log instead.
   */
  private async subscriberStarts(): Promise<Map<string, Date>> {
    if (this.starts) return this.starts;
    const declared = this.manifests
      .all()
      .flatMap((m) => m.subscribes.map((s) => ({ key: `${m.name}.${s.handler}`, replay: s.replay })));
    if (declared.length > 0) {
      await this.db
        .insert(eventSubscribers)
        .values(
          declared.map((d) => ({
            subscriber: d.key,
            startsAt: d.replay ? new Date(0) : this.bootedAt,
          })),
        )
        .onConflictDoNothing();
    }
    const rows = await this.db.select().from(eventSubscribers);
    this.starts = new Map(rows.map((r) => [r.subscriber, r.startsAt]));
    return this.starts;
  }

  /**
   * Create one delivery row per subscriber for events that have none yet.
   * Splitting fan-out from delivery is what lets a replay be just flipping rows back to
   * 'pending'.
   *
   * Only events somebody listens to are looked at, and only from when they started
   * listening. Both conditions are in the query rather than the loop, and that is the fix
   * for a fault that never mattered while nothing subscribed: the window used to be "the
   * oldest 200 events with no delivery rows", and an event nobody subscribes to never gets
   * one — so once 200 of those existed, the window filled with them permanently and no
   * subscriber would ever have been reached. And without a start point, the first subscriber
   * would have been handed the platform's entire history.
   */
  private async fanOut(): Promise<void> {
    const starts = await this.subscriberStarts();
    const startOf = (module: string, handler: string) =>
      starts.get(`${module}.${handler}`) ?? this.bootedAt;

    // Per event name, the earliest point any of its subscribers listens from.
    const from = new Map<string, Date>();
    for (const m of this.manifests.all()) {
      for (const s of m.subscribes) {
        const at = startOf(m.name, s.handler);
        const current = from.get(s.event);
        if (!current || at < current) from.set(s.event, at);
      }
    }
    if (from.size === 0) return;

    const unfanned = await this.db
      .select({
        id: events.id,
        eventName: events.eventName,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(
        and(
          or(
            ...[...from].map(([name, at]) =>
              and(eq(events.eventName, name), gte(events.createdAt, at)),
            ),
          ),
          sql`NOT EXISTS (SELECT 1 FROM ${eventDeliveries} WHERE ${eventDeliveries.eventId} = ${events.id})`,
        ),
      )
      .orderBy(asc(events.createdAt))
      .limit(200);

    for (const event of unfanned) {
      // Every event here has at least one subscriber listening from before it — the query
      // guarantees it — so it always leaves the window. Later starters skip it.
      const subscribers = this.manifests
        .subscribersOf(event.eventName)
        .filter((s) => event.createdAt >= startOf(s.module, s.handler));
      if (subscribers.length === 0) continue;

      await this.db
        .insert(eventDeliveries)
        .values(
          subscribers.map((s) => ({
            eventId: event.id,
            subscriber: `${s.module}.${s.handler}`,
            status: 'pending',
          })),
        )
        .onConflictDoNothing();
    }
  }

  private async deliver(): Promise<void> {
    const due = await this.db
      .select({
        eventId: eventDeliveries.eventId,
        subscriber: eventDeliveries.subscriber,
        attempts: eventDeliveries.attempts,
        eventName: events.eventName,
        entityType: events.entityType,
        entityId: events.entityId,
        actorId: events.actorId,
        payload: events.payload,
      })
      .from(eventDeliveries)
      .innerJoin(events, eq(events.id, eventDeliveries.eventId))
      .where(
        and(
          or(eq(eventDeliveries.status, 'pending'), eq(eventDeliveries.status, 'failed')),
          lt(eventDeliveries.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(events.createdAt))
      .limit(100);

    for (const row of due) {
      const [moduleName, handlerName] = row.subscriber.split('.');
      const handler = this.handlers.get(moduleName!, handlerName!);

      if (!handler) {
        // Declared in a manifest but never bound — a wiring bug, not a transient fault.
        await this.markFailed(row.eventId, row.subscriber, row.attempts, 'handler not bound');
        continue;
      }

      const ctx: EventContext = {
        eventId: row.eventId,
        eventName: row.eventName,
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: row.actorId,
        payload: (row.payload ?? {}) as Record<string, unknown>,
      };

      try {
        await handler(ctx);
        await this.db
          .update(eventDeliveries)
          .set({ status: 'done', attempts: row.attempts + 1, processedAt: new Date() })
          .where(this.key(row.eventId, row.subscriber));
      } catch (err) {
        await this.markFailed(row.eventId, row.subscriber, row.attempts, (err as Error).message);
      }
    }
  }

  private async markFailed(
    eventId: string,
    subscriber: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const next = attempts + 1;
    const dead = next >= MAX_ATTEMPTS;
    await this.db
      .update(eventDeliveries)
      .set({
        status: dead ? 'dead' : 'failed',
        attempts: next,
        lastError: error.slice(0, 500),
        processedAt: new Date(),
      })
      .where(this.key(eventId, subscriber));

    const message = `Delivery ${subscriber} for event ${eventId} failed (attempt ${next}): ${error}`;
    if (dead) this.logger.error(`${message} — DEAD LETTER, no further retries`);
    else this.logger.warn(message);
  }

  private key(eventId: string, subscriber: string) {
    return and(eq(eventDeliveries.eventId, eventId), eq(eventDeliveries.subscriber, subscriber));
  }

  /** Dead letters, for the admin endpoint. */
  async deadLetters() {
    return this.db
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.status, 'dead'))
      .limit(100);
  }

  /** Replay: reset dead deliveries to pending. Used after fixing the cause. */
  async replay(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const updated = await this.db
      .update(eventDeliveries)
      .set({ status: 'pending', attempts: 0, lastError: null })
      .where(
        and(eq(eventDeliveries.status, 'dead'), inArray(eventDeliveries.eventId, eventIds)),
      )
      .returning({ eventId: eventDeliveries.eventId });
    return updated.length;
  }
}
