import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { eventDeliveries, events } from '../db/core.schema.js';
import { EventBus } from './event-bus.service.js';
import { EventHandlerRegistry, type EventContext } from './event-handler.registry.js';
import { ManifestRegistry } from '../manifest/manifest.registry.js';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 5_000;

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
   * Create one delivery row per declared subscriber for events that have none yet.
   * Splitting fan-out from delivery is what lets a subscriber added later pick up
   * only new events, while a replay is just flipping rows back to 'pending'.
   */
  private async fanOut(): Promise<void> {
    const unfanned = await this.db
      .select({
        id: events.id,
        eventName: events.eventName,
      })
      .from(events)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${eventDeliveries} WHERE ${eventDeliveries.eventId} = ${events.id})`,
      )
      .orderBy(asc(events.createdAt))
      .limit(200);

    for (const event of unfanned) {
      const subscribers = this.manifests.subscribersOf(event.eventName);
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
