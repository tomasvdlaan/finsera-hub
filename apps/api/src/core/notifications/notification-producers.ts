import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { departments, entities, userDepartments, users } from '../db/core.schema.js';
import { EventHandlerRegistry, type EventContext } from '../events/event-handler.registry.js';
import { NotificationService } from './notification.service.js';

/**
 * Events in, notifications out. One handler per subscription the core manifest declares.
 *
 * Every handler is idempotent the same way: the dedupe key is derived from the event or the
 * mention it is about, so the bus delivering it twice writes one row. Titles are built from
 * the registry's display name and the actor's name — the lock-screen sentence: who, what,
 * which, and nothing from inside the record.
 */
@Injectable()
export class NotificationProducers implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly handlers: EventHandlerRegistry,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.handlers.bind('core', 'notifyMentioned', (ctx) => this.mentioned(ctx));
    this.handlers.bind('core', 'notifyTaskAssigned', (ctx) => this.taskAssigned(ctx));
    this.handlers.bind('core', 'notifyTaskBlocked', (ctx) => this.taskBlocked(ctx));
    this.handlers.bind('core', 'notifyActionItem', (ctx) => this.actionItem(ctx));
    this.handlers.bind('core', 'notifyTicketOpened', (ctx) => this.ticketOpened(ctx));
    this.handlers.bind('core', 'notifyTicketReplied', (ctx) => this.ticketReplied(ctx));
    this.handlers.bind('core', 'notifyTicketAssigned', (ctx) => this.ticketAssigned(ctx));
    this.handlers.bind('core', 'notifyQuoteAccepted', (ctx) => this.quoteDecided(ctx, true));
    this.handlers.bind('core', 'notifyQuoteRejected', (ctx) => this.quoteDecided(ctx, false));
    this.handlers.bind('core', 'notifyTimesheetReturned', (ctx) => this.timesheetReturned(ctx));
    this.handlers.bind('core', 'notifyTimesheetSubmitted', (ctx) => this.timesheetSubmitted(ctx));
  }

  /** Somebody was named in a comment. One notification per person named. */
  async mentioned(ctx: EventContext): Promise<void> {
    const named = (ctx.payload.mentions ?? []) as Array<{ id: string; userId: string }>;
    if (named.length === 0) return;
    const [actor, subject] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);

    for (const m of named) {
      await this.notifications.notify({
        personId: m.userId,
        category: 'mention',
        tier: 'now',
        title:
          m.userId === ctx.actorId
            ? `Your reminder on ${subject}`
            : `${actor ?? 'Somebody'} mentioned you on ${subject}`,
        // The same keys the migration used for mentions that were already waiting.
        groupKey: `comments:${ctx.entityId}`,
        dedupeKey: `mention:${m.id}`,
        subjectId: ctx.entityId,
        subjectType: ctx.entityType,
        actorId: ctx.actorId,
      });
    }
  }

  /** A task was given to somebody — on creation or later. */
  async taskAssigned(ctx: EventContext): Promise<void> {
    const assigneeId = ctx.payload.assigneeId as string | null | undefined;
    if (!assigneeId) return;
    const [actor, task] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);

    await this.notifications.notify({
      personId: assigneeId,
      category: 'task',
      tier: 'now',
      title: actor ? `${actor} assigned you ${task}` : `You were assigned ${task}`,
      groupKey: `task:${ctx.entityId}`,
      dedupeKey: `task.assigned:${ctx.eventId}`,
      subjectId: ctx.entityId,
      subjectType: ctx.entityType,
      actorId: ctx.actorId,
    });
  }

  /** A card somebody cannot move until the person it names does something. */
  async taskBlocked(ctx: EventContext): Promise<void> {
    const on = ctx.payload.blockedOnUserId as string | null | undefined;
    if (!on) return;
    const [actor, task] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);
    await this.notifications.notify({
      personId: on,
      category: 'task',
      tier: 'now',
      title: `${actor ?? 'Somebody'} is waiting on you for ${task}`,
      groupKey: `task:${ctx.entityId}`,
      dedupeKey: `task.blocked:${ctx.eventId}`,
      subjectId: ctx.entityId,
      subjectType: ctx.entityType,
      actorId: ctx.actorId,
    });
  }

  /**
   * An action point from a meeting is now somebody's. The meetings module only publishes this
   * for an assignee who can open the note — a restricted note stays shut to everyone else.
   */
  async actionItem(ctx: EventContext): Promise<void> {
    const assigneeId = ctx.payload.assigneeId as string | undefined;
    const itemId = ctx.payload.actionItemId as string | undefined;
    if (!assigneeId || !itemId) return;
    const [actor, meeting] = await Promise.all([this.nameOf(ctx.actorId), this.subjectName(ctx.entityId)]);
    await this.notifications.notify({
      personId: assigneeId,
      category: 'task',
      tier: 'now',
      title: `${actor ?? 'Somebody'} gave you an action point from ${meeting}`,
      groupKey: `actions:${ctx.entityId}`,
      dedupeKey: `action_item.assigned:${itemId}:${assigneeId}`,
      subjectId: ctx.entityId,
      subjectType: ctx.entityType,
      actorId: ctx.actorId,
    });
  }

  /** A client opened a ticket: whoever answers for them, else delivery. */
  async ticketOpened(ctx: EventContext): Promise<void> {
    const ticketId = ctx.payload.ticketId as string | undefined;
    if (!ticketId) return;
    const client = (await this.subjectNameOf(ctx.entityId)) ?? 'A client';
    const subject = this.quote(ctx.payload.subject);
    for (const personId of await this.orDepartment([ctx.payload.ownerId], 'delivery')) {
      await this.notifications.notify({
        personId,
        category: 'client',
        tier: 'now',
        title: `${client} opened a ticket: ${subject}`,
        groupKey: `ticket:${ticketId}`,
        dedupeKey: `portal.ticket_opened:${ctx.eventId}`,
        subjectId: ctx.entityId,
        subjectType: ctx.entityType,
        url: `/portal/tickets/${ticketId}`,
      });
    }
  }

  /** A client replied: the ticket's assignee, else whoever answers for the client, else delivery. */
  async ticketReplied(ctx: EventContext): Promise<void> {
    const ticketId = ctx.payload.ticketId as string | undefined;
    if (!ticketId) return;
    const client = (await this.subjectNameOf(ctx.entityId)) ?? 'A client';
    const subject = this.quote(ctx.payload.subject);
    const first = ctx.payload.assignedTo ?? ctx.payload.ownerId;
    for (const personId of await this.orDepartment([first], 'delivery')) {
      await this.notifications.notify({
        personId,
        category: 'client',
        tier: 'now',
        title: `${client} replied on ${subject}`,
        groupKey: `ticket:${ticketId}`,
        dedupeKey: `portal.ticket_replied:${ctx.eventId}`,
        subjectId: ctx.entityId,
        subjectType: ctx.entityType,
        url: `/portal/tickets/${ticketId}`,
      });
    }
  }

  async ticketAssigned(ctx: EventContext): Promise<void> {
    const ticketId = ctx.payload.ticketId as string | undefined;
    const to = ctx.payload.assignedTo as string | undefined;
    if (!ticketId || !to) return;
    const [actor, client] = await Promise.all([this.nameOf(ctx.actorId), this.subjectNameOf(ctx.entityId)]);
    await this.notifications.notify({
      personId: to,
      category: 'client',
      tier: 'now',
      title: `${actor ?? 'Somebody'} gave you ${client ?? 'a client'}'s ticket ${this.quote(ctx.payload.subject)}`,
      groupKey: `ticket:${ticketId}`,
      dedupeKey: `ticket.assigned:${ctx.eventId}`,
      subjectId: ctx.entityId,
      subjectType: ctx.entityType,
      actorId: ctx.actorId,
      url: `/portal/tickets/${ticketId}`,
    });
  }

  /**
   * A quote was decided. Accepted is *now* — a client said yes, and a project is waiting to be
   * set up; declined can wait for the day. The client's reason never travels in a title.
   */
  async quoteDecided(ctx: EventContext, accepted: boolean): Promise<void> {
    const number = (ctx.payload.number as string | null) ?? null;
    const clientName = await this.subjectNameOf(ctx.payload.clientId);
    const quote = number ? `quote ${number}` : 'a quote';
    const verb = accepted ? 'accepted' : 'declined';
    const title = !ctx.actorId
      ? `${clientName ?? 'A client'} ${verb} ${quote}${accepted ? ' in the portal' : ''}`
      : `${(await this.nameOf(ctx.actorId)) ?? 'Somebody'} marked ${quote} ${verb}`;
    for (const personId of await this.orDepartment([ctx.payload.createdBy, ctx.payload.ownerId], 'sales')) {
      await this.notifications.notify({
        personId,
        category: 'client',
        tier: accepted ? 'now' : 'today',
        title,
        groupKey: `quote:${ctx.entityId}`,
        dedupeKey: `quote.${verb}:${ctx.eventId}`,
        subjectId: ctx.entityId,
        subjectType: ctx.entityType,
        actorId: ctx.actorId,
      });
    }
  }

  /** A week sent back is the person's to fix. The reason is on the Time page, not here. */
  async timesheetReturned(ctx: EventContext): Promise<void> {
    const personId = ctx.payload.personId as string | undefined;
    const weekOf = ctx.payload.weekOf as string | undefined;
    if (!personId || !weekOf) return;
    const actor = await this.nameOf(ctx.actorId);
    await this.notifications.notify({
      personId,
      category: 'time',
      tier: 'now',
      title: `${actor ?? 'Somebody'} sent back your week of ${this.day(weekOf)}`,
      groupKey: `timesheet:${weekOf}`,
      dedupeKey: `timesheet.returned:${ctx.eventId}`,
      actorId: ctx.actorId,
      url: `/time/week?date=${weekOf}`,
    });
  }

  /** A week waits for approval: the people who may approve — admins, since the capability is. */
  async timesheetSubmitted(ctx: EventContext): Promise<void> {
    const personId = ctx.payload.personId as string | undefined;
    const weekOf = ctx.payload.weekOf as string | undefined;
    if (!personId || !weekOf) return;
    const who = (await this.nameOf(personId)) ?? 'Somebody';
    const approvers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
    for (const a of approvers) {
      await this.notifications.notify({
        personId: a.id,
        category: 'time',
        tier: 'today',
        title: `${who} submitted their week of ${this.day(weekOf)}`,
        groupKey: `approvals:${weekOf}`,
        dedupeKey: `timesheet.submitted:${ctx.eventId}`,
        actorId: personId,
        url: `/time/week?date=${weekOf}`,
      });
    }
  }

  /**
   * The people named, or — when nobody is — the department the matching Inbox rule already
   * addresses. The same fallback the Inbox uses, so a notification never reaches somebody who
   * would not have seen the item there.
   */
  private async orDepartment(named: unknown[], department: string): Promise<string[]> {
    const ids = [...new Set(named.filter((x): x is string => typeof x === 'string' && x.length > 0))];
    if (ids.length > 0) return ids;
    const rows = await this.db
      .select({ id: users.id })
      .from(userDepartments)
      .innerJoin(departments, eq(departments.id, userDepartments.departmentId))
      .innerJoin(users, eq(users.id, userDepartments.userId))
      .where(and(eq(departments.key, department), eq(users.isActive, true)));
    return rows.map((r) => r.id);
  }

  /** A client-typed subject line, quoted and cut short — a lock screen is not the place to read. */
  private quote(value: unknown): string {
    return typeof value === 'string' && value.trim() ? `“${value.trim().slice(0, 80)}”` : 'a ticket';
  }

  private day(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  private async subjectNameOf(entityId: unknown): Promise<string | null> {
    if (typeof entityId !== 'string') return null;
    const [row] = await this.db
      .select({ name: entities.displayName })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
    return row?.name ?? null;
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.name ?? null;
  }

  /** The record's name as the registry holds it — quoted, so a title reads as one. */
  private async subjectName(entityId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: entities.displayName })
      .from(entities)
      .where(inArray(entities.id, [entityId]))
      .limit(1);
    return row ? `“${row.name}”` : 'a record';
  }
}
