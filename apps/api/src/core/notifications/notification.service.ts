import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  DEFAULT_PUSH,
  notificationSettingsSchema,
  type Actor,
  type NotificationSettings,
  type NotificationTier,
  type NotificationView,
} from '@platform/contracts';
import { DB, type Database } from '../db/db.module.js';
import {
  comments,
  entities,
  mentions,
  notificationSettings,
  notifications,
  users,
} from '../db/core.schema.js';
import { PermissionService } from '../permissions/permission.service.js';

export interface NotifyInput {
  personId: string;
  category: string;
  tier: NotificationTier;
  title: string;
  /** Occurrences sharing this key are shown, and pushed, as one. */
  groupKey: string;
  /** Unique per person: the same occurrence never notifies twice. */
  dedupeKey: string;
  subjectId?: string | null;
  subjectType?: string | null;
  actorId?: string | null;
  insightId?: string | null;
  /** Where opening it goes, when that is not the subject's page. A path on this site. */
  url?: string | null;
}

/** A notification as it was written, for whatever delivers it next (push, in N1). */
export interface CreatedNotification extends NotifyInput {
  id: string;
}

type Listener = (n: CreatedNotification) => void | Promise<void>;

/** How much of a mentioning comment the in-app entry shows — the same as the mentions list. */
const EXCERPT = 160;

/** How long a read notification stays in the list before only the unread ones remain. */
const KEEP_READ_DAYS = 14;

/**
 * The Inbox's *For you* — one record per person per occurrence. See
 * docs/notifications-brief.md.
 *
 * Everything that decides whether somebody is told lives here, so no producer can forget a
 * rule: the actor is not told about their own act, an inactive account is told nothing, and
 * nobody is told about a record they could not open.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly listeners: Listener[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: PermissionService,
  ) {}

  /** Called for every notification actually written — the seam push hangs off. */
  onCreated(fn: Listener): void {
    this.listeners.push(fn);
  }

  /**
   * Write a notification for one person, if the rules allow — and hand it to the delivery
   * hooks, unless the caller will deliver it itself (`deliver: false`, the morning brief).
   */
  async notify(input: NotifyInput, opts: { deliver?: boolean } = {}): Promise<CreatedNotification | null> {
    /*
     * Never about your own act — with one exception, kept on purpose.
     *
     * Naming yourself in a comment is allowed (see `mentions` in the schema): `@me chase this
     * Friday` is a reminder typed deliberately, and the Inbox has always shown it. So a
     * self-mention is still recorded; the push router never sends anything whose actor is the
     * person, so it never interrupts anybody.
     */
    if (input.actorId && input.actorId === input.personId && input.category !== 'mention') {
      return null;
    }

    const [person] = await this.db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, input.personId))
      .limit(1);
    if (!person?.isActive) return null;

    /*
     * Never about something they could not open.
     *
     * Producers resolve recipients from the event — an assignee, a client owner — and the
     * event knows nothing about visibility: the notification would be a link to a refusal,
     * and its title would already have said what the record is.
     *
     * `visibleIds`, not `canSee`: `canSee` answers whether a record exists, for write paths,
     * and would have let a member be told about a type only admins may read. `visibleIds` is
     * type-level, so a restriction on one record — a restricted meeting note — is the
     * producer's to respect when it picks recipients.
     */
    if (input.subjectId) {
      const actor: Actor = { userId: person.id, role: person.role as Actor['role'] };
      const visible = await this.permissions.visibleIds(actor, [input.subjectId]);
      if (!visible.has(input.subjectId)) return null;
    }

    const id = uuidv7();
    const [row] = await this.db
      .insert(notifications)
      .values({
        id,
        personId: input.personId,
        category: input.category,
        tier: input.tier,
        title: input.title,
        groupKey: input.groupKey,
        dedupeKey: input.dedupeKey,
        subjectId: input.subjectId ?? null,
        subjectType: input.subjectType ?? null,
        actorId: input.actorId ?? null,
        insightId: input.insightId ?? null,
        url: input.url?.startsWith('/') ? input.url : null,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!row) return null; // already told — a redelivered event

    const created: CreatedNotification = { ...input, id: row.id };
    if (opts.deliver === false) return created;
    for (const fn of this.listeners) {
      // A delivery failure is the delivery's problem: the record is written and stays.
      try {
        await fn(created);
      } catch (err) {
        this.logger.warn(`Delivery hook failed for ${row.id}: ${(err as Error).message}`);
      }
    }
    return created;
  }

  /**
   * What is waiting for the person asking, newest first, one entry per thing.
   *
   * Occurrences that share a group are collapsed into the newest of them, with a count of the
   * unread ones — "5 comments on this task" — so a busy thread is one line, not five.
   */
  async list(actor: Actor, limit = 50): Promise<NotificationView[]> {
    const since = new Date(Date.now() - KEEP_READ_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        id: notifications.id,
        category: notifications.category,
        tier: notifications.tier,
        title: notifications.title,
        groupKey: notifications.groupKey,
        subjectId: notifications.subjectId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        url: notifications.url,
        actorName: users.displayName,
        urlPath: entities.urlPath,
        deletedAt: entities.deletedAt,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .leftJoin(entities, eq(entities.id, notifications.subjectId))
      .where(
        and(
          eq(notifications.personId, actor.userId),
          isNull(notifications.clearedAt),
          or(isNull(notifications.readAt), gt(notifications.readAt, since)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(400);

    const groups = new Map<string, NotificationView>();
    for (const r of rows) {
      const seen = groups.get(r.groupKey);
      if (seen) {
        if (!r.readAt) {
          seen.count += 1;
          seen.read = false;
        }
        continue;
      }
      groups.set(r.groupKey, {
        id: r.id,
        category: r.category,
        tier: r.tier as NotificationTier,
        title: r.title,
        url: r.url ?? (r.urlPath && !r.deletedAt ? r.urlPath : null),
        subjectId: r.subjectId,
        actorName: r.actorName ?? null,
        count: r.readAt ? 0 : 1,
        read: !!r.readAt,
        createdAt: r.createdAt.toISOString(),
      });
    }
    const shown = [...groups.values()].slice(0, limit);
    await this.attachExcerpts(shown);
    return shown;
  }

  /**
   * The start of the comment, for mention entries — in one query for the whole page. In-app
   * only: the list sits behind a sign-in, a lock screen does not.
   */
  private async attachExcerpts(shown: NotificationView[]): Promise<void> {
    const ids = shown.filter((n) => n.category === 'mention').map((n) => n.id);
    if (ids.length === 0) return;
    const found = await this.db
      .select({ id: notifications.id, body: comments.body, deletedAt: comments.deletedAt })
      .from(notifications)
      .innerJoin(mentions, sql`${notifications.dedupeKey} = 'mention:' || ${mentions.id}::text`)
      .innerJoin(comments, eq(comments.id, mentions.commentId))
      .where(inArray(notifications.id, ids));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const n of shown) {
      const f = byId.get(n.id);
      if (!f || f.deletedAt) continue;
      n.excerpt = f.body.length > EXCERPT ? `${f.body.slice(0, EXCERPT).trimEnd()}…` : f.body;
    }
  }

  /** The badge: how many things — groups, not occurrences — are unread. */
  async count(actor: Pick<Actor, 'userId'>): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(DISTINCT ${notifications.groupKey})::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.personId, actor.userId),
          isNull(notifications.clearedAt),
          isNull(notifications.readAt),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * Mark read: the groups the given entries stand for, or everything waiting.
   *
   * Reading a mention also reads the mention itself, so the two records never disagree about
   * whether somebody has seen it.
   */
  async markRead(actor: Pick<Actor, 'userId'>, ids?: string[]): Promise<{ read: number }> {
    const mine = eq(notifications.personId, actor.userId);
    const unread = isNull(notifications.readAt);
    let scope = and(mine, unread);
    if (ids && ids.length > 0) {
      const picked = await this.db
        .select({ groupKey: notifications.groupKey })
        .from(notifications)
        .where(and(mine, inArray(notifications.id, ids)));
      const keys = [...new Set(picked.map((p) => p.groupKey))];
      if (keys.length === 0) return { read: 0 };
      scope = and(mine, unread, inArray(notifications.groupKey, keys));
    }

    const now = new Date();
    const updated = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(scope)
      .returning({ dedupeKey: notifications.dedupeKey });

    const mentionIds = updated
      .map((u) => /^mention:(.+)$/.exec(u.dedupeKey)?.[1])
      .filter((x): x is string => !!x);
    if (mentionIds.length > 0) {
      await this.db
        .update(mentions)
        .set({ readAt: now })
        .where(and(eq(mentions.userId, actor.userId), inArray(mentions.id, mentionIds), isNull(mentions.readAt)));
    }
    return { read: updated.length };
  }

  /** The cause went away — the ticket answered, the clock stopped. Leaves read state alone. */
  async clear(where: { insightId?: string; groupKey?: string; personId?: string }): Promise<number> {
    const conditions = [isNull(notifications.clearedAt)];
    if (where.insightId) conditions.push(eq(notifications.insightId, where.insightId));
    if (where.groupKey) conditions.push(eq(notifications.groupKey, where.groupKey));
    if (where.personId) conditions.push(eq(notifications.personId, where.personId));
    if (conditions.length === 1) return 0; // never clear everything by accident
    const cleared = await this.db
      .update(notifications)
      .set({ clearedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: notifications.id });
    return cleared.length;
  }

  /** Uncleared groups whose key starts with `prefix` — for a producer tidying up after itself. */
  async openGroups(prefix: string): Promise<Array<{ personId: string; groupKey: string }>> {
    return this.db
      .selectDistinct({ personId: notifications.personId, groupKey: notifications.groupKey })
      .from(notifications)
      .where(and(isNull(notifications.clearedAt), sql`${notifications.groupKey} LIKE ${`${prefix}%`}`));
  }

  /**
   * Mute or unmute comment notifications on one record. A mention or an assignment still gets
   * through — muting a thread is not muting the people in it addressing you.
   */
  async mute(actor: Actor, subjectId: string, muted: boolean): Promise<NotificationSettings> {
    const current = await this.settings(actor.userId);
    const set = new Set(current.muted);
    if (muted) set.add(subjectId);
    else set.delete(subjectId);
    return this.saveSettings(actor, { ...current, muted: [...set] });
  }

  /** This person's settings, with every default filled in. */
  async settings(personId: string): Promise<NotificationSettings> {
    const [row] = await this.db
      .select({ settings: notificationSettings.settings })
      .from(notificationSettings)
      .where(eq(notificationSettings.personId, personId))
      .limit(1);
    const parsed = notificationSettingsSchema.safeParse(row?.settings ?? {});
    const settings = parsed.success ? parsed.data : notificationSettingsSchema.parse({});
    return { ...settings, push: { ...DEFAULT_PUSH, ...settings.push } };
  }

  async saveSettings(actor: Actor, input: unknown): Promise<NotificationSettings> {
    const parsed = notificationSettingsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException(
        `Notification settings: ${issue?.path.join('.') || 'value'} — ${issue?.message ?? 'invalid'}`,
      );
    }
    const settings = parsed.data;
    await this.db
      .insert(notificationSettings)
      .values({ personId: actor.userId, settings })
      .onConflictDoUpdate({
        target: notificationSettings.personId,
        set: { settings, updatedAt: new Date() },
      });
    return this.settings(actor.userId);
  }
}
