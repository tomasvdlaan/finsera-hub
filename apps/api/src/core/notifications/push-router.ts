import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { entities, notificationDeliveries, notifications } from '../db/core.schema.js';
import { NotificationService, type CreatedNotification } from './notification.service.js';
import { PushService } from './push.service.js';
import { nextWorkingStart, withinWorkingHours } from './working-hours.js';

/** One push per subject per this long; the rest are in the Inbox (brief N8). */
const COLLAPSE_MS = 15 * 60_000;
/** A backstop that should never be reached. If it is, a rule is wrong — and the log says which. */
const DAILY_CAP = 20;
const TICK_MS = 60_000;

type Decision =
  | { status: 'send' }
  | { status: 'held'; until: Date }
  | { status: 'skipped'; reason: string };

/**
 * Whether a notification may interrupt somebody, and when. The rules of the brief, in one place:
 * only the *now* tier pushes; only categories the person left on; never their own act; never
 * outside their working hours — held, not dropped; one push per subject per quarter hour; and a
 * daily ceiling. Every decision is written to `notification_deliveries`, so "why didn't my phone
 * buzz?" has an answer.
 */
@Injectable()
export class PushRouter implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PushRouter.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationService,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    this.notifications.onCreated((n) => this.route(n));
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.NOTIFICATIONS_DISABLED) return;
    this.timer = setInterval(() => void this.releaseHeld(), TICK_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async decide(n: CreatedNotification, now = new Date()): Promise<Decision> {
    if (n.tier !== 'now') return { status: 'skipped', reason: `tier ${n.tier}` };
    if (n.actorId && n.actorId === n.personId) return { status: 'skipped', reason: 'own act' };
    if (!this.push.enabled) return { status: 'skipped', reason: 'push not configured' };
    const settings = await this.notifications.settings(n.personId);
    if (settings.push[n.category] === false) return { status: 'skipped', reason: 'category off' };
    if (!(await this.push.hasDevices(n.personId))) return { status: 'skipped', reason: 'no devices' };

    if (await this.sentRecently(n.personId, n.groupKey, now)) {
      return { status: 'skipped', reason: 'collapsed' };
    }
    if ((await this.sentToday(n.personId, now)) >= DAILY_CAP) {
      return { status: 'skipped', reason: 'daily cap' };
    }
    if (!withinWorkingHours(settings, now)) {
      const until = nextWorkingStart(settings, now);
      return until ? { status: 'held', until } : { status: 'skipped', reason: 'no working hours' };
    }
    return { status: 'send' };
  }

  async route(n: CreatedNotification): Promise<void> {
    const decision = await this.decide(n);
    // `tier` skips are not worth a row each: most notifications are not meant to push at all.
    if (decision.status === 'skipped' && decision.reason.startsWith('tier ')) return;

    const id = uuidv7();
    if (decision.status === 'send') {
      const result = await this.push.send(n.personId, await this.payloadFor(n.id, n));
      await this.record(id, n.id, result.delivered ? 'sent' : 'failed', { error: result.error });
      return;
    }
    if (decision.status === 'held') {
      await this.record(id, n.id, 'held', { scheduledFor: decision.until });
      return;
    }
    await this.record(id, n.id, 'skipped', { reason: decision.reason });
  }

  /**
   * Send what waited for the working day. One push per person: a single waiting notification
   * as itself, several as one line that opens the Inbox — the morning should not start with a
   * stack of buzzes about last night.
   */
  async releaseHeld(now = new Date()): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const due = await this.db
        .select({
          deliveryId: notificationDeliveries.id,
          notificationId: notifications.id,
          personId: notifications.personId,
          title: notifications.title,
          groupKey: notifications.groupKey,
          readAt: notifications.readAt,
          clearedAt: notifications.clearedAt,
          subjectId: notifications.subjectId,
          url: notifications.url,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
        .where(
          and(
            eq(notificationDeliveries.status, 'held'),
            lte(notificationDeliveries.scheduledFor, now),
          ),
        );

      const byPerson = new Map<string, typeof due>();
      for (const d of due) byPerson.set(d.personId, [...(byPerson.get(d.personId) ?? []), d]);

      for (const [personId, items] of byPerson) {
        // Already seen in the app, or its cause gone: nothing left to say.
        const live = items.filter((i) => !i.readAt && !i.clearedAt);
        const stale = items.filter((i) => i.readAt || i.clearedAt);
        if (stale.length > 0) {
          await this.mark(stale.map((s) => s.deliveryId), 'skipped', 'read or cleared while held');
        }
        if (live.length === 0) continue;

        const payload =
          live.length === 1
            ? await this.payloadFor(live[0]!.notificationId, live[0]!)
            : {
                id: null,
                title: `${live.length} things for you while you were away`,
                url: '/insights',
                tag: 'held-summary',
                badge: await this.notifications.count({ userId: personId }),
              };
        const result = await this.push.send(personId, payload);
        await this.mark(
          live.map((l) => l.deliveryId),
          result.delivered ? 'sent' : 'failed',
          live.length > 1 ? 'summarised' : null,
          result.error,
        );
      }
      return due.length;
    } catch (err) {
      this.logger.error(`Releasing held pushes failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  /** Opened from a push: mark the delivery opened and the notification read. */
  async opened(personId: string, notificationId: string): Promise<void> {
    const [n] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), eq(notifications.personId, personId)))
      .limit(1);
    if (!n) return;
    await this.db
      .update(notificationDeliveries)
      .set({ openedAt: new Date() })
      .where(and(eq(notificationDeliveries.notificationId, n.id), isNull(notificationDeliveries.openedAt)));
    await this.notifications.markRead({ userId: personId }, [n.id]);
  }

  private async payloadFor(
    id: string,
    n: { personId: string; title: string; groupKey: string; subjectId?: string | null; url?: string | null },
  ) {
    let url = n.url?.startsWith('/') ? n.url : '/insights';
    if (!n.url && n.subjectId) {
      const [e] = await this.db
        .select({ urlPath: entities.urlPath, deletedAt: entities.deletedAt })
        .from(entities)
        .where(eq(entities.id, n.subjectId))
        .limit(1);
      if (e && !e.deletedAt) url = e.urlPath;
    }
    return {
      id,
      title: n.title,
      url,
      tag: n.groupKey,
      badge: await this.notifications.count({ userId: n.personId }),
    };
  }

  private async sentRecently(personId: string, groupKey: string, now: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(
        and(
          eq(notifications.personId, personId),
          eq(notifications.groupKey, groupKey),
          eq(notificationDeliveries.status, 'sent'),
          gte(notificationDeliveries.sentAt, new Date(now.getTime() - COLLAPSE_MS)),
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  private async sentToday(personId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(
        and(
          eq(notifications.personId, personId),
          eq(notificationDeliveries.status, 'sent'),
          gte(notificationDeliveries.sentAt, new Date(now.getTime() - 24 * 60 * 60_000)),
        ),
      );
    return row?.n ?? 0;
  }

  private async record(
    id: string,
    notificationId: string,
    status: string,
    extra: { reason?: string; scheduledFor?: Date; error?: string },
  ): Promise<void> {
    await this.db
      .insert(notificationDeliveries)
      .values({
        id,
        notificationId,
        channel: 'push',
        status,
        reason: extra.reason ?? null,
        scheduledFor: extra.scheduledFor ?? null,
        sentAt: status === 'sent' ? new Date() : null,
        error: extra.error ?? null,
      })
      .onConflictDoNothing();
  }

  private async mark(ids: string[], status: string, reason: string | null, error?: string) {
    if (ids.length === 0) return;
    await this.db
      .update(notificationDeliveries)
      .set({
        status,
        reason,
        error: error ?? null,
        sentAt: status === 'sent' ? new Date() : null,
      })
      .where(inArray(notificationDeliveries.id, ids));
  }
}
