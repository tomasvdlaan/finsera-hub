import { NotificationService } from '../../core/notifications/notification.service.js';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { DepartmentsService } from '../../core/auth/departments.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { insightRows } from './insights.schema.js';
import { RULES, type Candidate } from './rules.js';

/**
 * The proactive insight service.
 *
 * It notices things and says so. It never acts: no email is sent, no invoice is chased, no
 * status is changed. Everything here ends in a sentence on a screen, because the whole
 * value of proactivity is lost the moment you cannot trust what it did while you were
 * away.
 *
 * Rules are deterministic SQL over published views. A model drafting a follow-up message
 * is useful; a model deciding which invoices are overdue is a worse version of a WHERE
 * clause.
 */

/** Which settings category each person-addressed rule belongs to. A rule absent here never notifies. */
const CATEGORY_OF: Record<string, string> = {
  task_aging_wip: 'task',
  task_overdue: 'task',
  task_blocked: 'task',
  waiting_on_client_too_long: 'task',
  ticket_waiting_on_us: 'client',
  quote_accepted_by_client: 'client',
  invoice_overdue: 'money',
  unbilled_work_ageing: 'money',
  budget_nearly_spent: 'money',
  contract_notice_closing: 'money',
  sprint_ending_soon_with_open_work: 'project',
  action_item_undecided: 'meeting',
};
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly departments: DepartmentsService,
    /* Optional so a test can build the engine without the notification layer. */
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /**
   * An item raised for somebody by name reaches them as a notification
   * (docs/notifications-brief.md N1, §4.2): *today* when it appears, promoted to *now* the
   * occurrence it escalates to urgent, cleared when it resolves.
   *
   * Only items with a `personId`. One addressed to a department stays in the Inbox — copying it
   * into every member's *For you* would make two lists that say the same thing, which is the
   * thing the brief exists to prevent. Rules about the platform or answered elsewhere are left
   * out: `setup_incomplete` is a chore, `quote_unanswered` a department's, and a clock left
   * running has its own reminders now.
   */
  private async tell(
    row: { id: string; rule: string; personId: string | null; subjectId: string | null; subjectType: string | null; title: string },
    occurrence: 'raised' | 'urgent' | 'reopened',
  ): Promise<void> {
    if (!this.notifications || !row.personId) return;
    const category = CATEGORY_OF[row.rule];
    if (!category) return;
    await this.notifications.notify({
      personId: row.personId,
      category,
      tier: occurrence === 'urgent' ? 'now' : 'today',
      title: row.title,
      groupKey: `insight:${row.id}`,
      dedupeKey:
        occurrence === 'reopened'
          ? `insight.reopened:${row.id}:${new Date().toISOString().slice(0, 10)}`
          : `insight.${occurrence}:${row.id}`,
      subjectId: row.subjectId,
      subjectType: row.subjectType,
      insightId: row.id,
    });
  }

  /**
   * Run every rule and reconcile the results against what is already known.
   *
   * Idempotent by construction: insights are matched on a natural key, so a condition
   * that is still true refreshes its existing insight rather than raising a duplicate.
   * Running this twice a minute and running it once a day produce the same rows, which is
   * what makes a background process safe to restart.
   */
  async refresh(): Promise<{ raised: number; refreshed: number; resolved: number }> {
    const candidates: Candidate[] = [];
    for (const rule of RULES) {
      try {
        const result = await this.db.execute(rule.query);
        for (const row of result.rows as Array<Record<string, unknown>>) {
          candidates.push(rule.toCandidate(row));
        }
      } catch (error) {
        // One broken rule must not silence the other five.
        this.logger.error(`Insight rule '${rule.name}' failed: ${(error as Error).message}`);
      }
    }

    const now = new Date();
    let raised = 0;
    let refreshed = 0;

    for (const c of candidates) {
      const [existing] = await this.db
        .select()
        .from(insightRows)
        .where(eq(insightRows.key, c.key))
        .limit(1);

      if (!existing) {
        const id = this.registry.newId();
        await this.db.insert(insightRows).values({
          id,
          key: c.key,
          rule: c.rule,
          subjectId: c.subjectId,
          subjectType: c.subjectType,
          personId: c.personId ?? null,
          audience: c.audience ?? null,
          severity: c.severity,
          title: c.title,
          detail: c.detail,
          facts: c.facts,
          magnitude: c.magnitude,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        raised++;
        await this.tell(
          { id, rule: c.rule, personId: c.personId ?? null, subjectId: c.subjectId, subjectType: c.subjectType, title: c.title },
          c.severity === 'urgent' ? 'urgent' : 'raised',
        );
        continue;
      }

      // A dismissed insight stays dismissed while its condition holds — dismissing means
      // "I know", and re-raising it tomorrow would make dismissal worthless.
      await this.db
        .update(insightRows)
        .set({
          title: c.title,
          detail: c.detail,
          facts: c.facts,
          magnitude: c.magnitude,
          severity: c.severity,
          // Carried on the refresh too: a rule that starts naming a person or a department
          // must narrow the insight it already raised, not only the next one.
          personId: c.personId ?? null,
          audience: c.audience ?? null,
          lastSeenAt: now,
          // A resolved insight whose condition returned is open again.
          status: existing.status === 'resolved' ? 'open' : existing.status,
          resolvedAt: existing.status === 'resolved' ? null : existing.resolvedAt,
        })
        .where(eq(insightRows.id, existing.id));
      refreshed++;

      // Dismissed means "I know" — it stays quiet however it changes.
      if (existing.status !== 'dismissed') {
        const told = { id: existing.id, rule: c.rule, personId: c.personId ?? null, subjectId: c.subjectId, subjectType: c.subjectType, title: c.title };
        if (existing.status === 'resolved') await this.tell(told, 'reopened');
        else if (c.severity === 'urgent' && existing.severity !== 'urgent') await this.tell(told, 'urgent');
      }
    }

    // Anything not seen this run has stopped being true: it resolves itself. An insight
    // that fixes itself should disappear, not wait to be dismissed.
    const keys = candidates.map((c) => c.key);
    const stale = await this.db
      .update(insightRows)
      .set({ status: 'resolved', resolvedAt: now })
      .where(
        and(
          inArray(insightRows.status, ['open', 'dismissed']),
          keys.length > 0 ? notInArray(insightRows.key, keys) : sql`TRUE`,
        ),
      )
      .returning({ id: insightRows.id });

    // Its cause went away, so what was said about it goes too — cleared, not marked read.
    if (this.notifications) {
      for (const r of stale) await this.notifications.clear({ insightId: r.id });
    }

    return { raised, refreshed, resolved: stale.length };
  }

  async list(actor: Actor, filter: { status?: string; rule?: string } = {}) {
    await this.require(actor, 'insights.read');
    /*
     * Addressed to you, or to a department you are in. Admins see everything.
     *
     * The filter is here rather than in the rules because it is not a rule's business who is
     * looking: a rule states a fact and says whose it is, and this decides who reads it.
     *
     * Three addresses, in order of precedence:
     *
     *   personId  — this is yours by name. A card you hold, a clock you left running.
     *   audience  — nobody in particular holds it, so whoever staffs that department does.
     *   neither   — admins only, deliberately. An item nobody is responsible for is the
     *               owner's, and showing it to everybody is how it became nobody's.
     *
     * An item named for somebody else never reaches you through its department: `personId`
     * winning outright is what stops "assigned to Ana" reappearing on the whole team's list.
     */
    const seesEverything = await this.permissions.can(actor, 'insights.read_all');
    const mine = await this.departments.keysFor(actor.userId);
    const addressedToMe = or(
      eq(insightRows.personId, actor.userId ?? ''),
      mine.length > 0
        ? and(isNull(insightRows.personId), inArray(insightRows.audience, mine))
        : undefined,
    );
    const where = [
      eq(insightRows.status, filter.status ?? 'open'),
      filter.rule ? eq(insightRows.rule, filter.rule) : undefined,
      seesEverything ? undefined : addressedToMe,
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(insightRows)
      .where(and(...where))
      .orderBy(desc(insightRows.severity), desc(insightRows.magnitude));

    // 'urgent' > 'attention' > 'info' — alphabetical ordering happens to invert that,
    // so severity is ranked explicitly rather than relying on the accident.
    const rank = { urgent: 0, attention: 1, info: 2 } as const;
    return rows.sort(
      (a, b) =>
        rank[a.severity as keyof typeof rank] - rank[b.severity as keyof typeof rank] ||
        b.magnitude - a.magnitude,
    );
  }

  /** "I know." The insight stays hidden until its condition goes away and returns. */
  async dismiss(actor: Actor, id: string) {
    await this.require(actor, 'insights.write');
    const row = await this.raw(id);
    await this.assertVisible(actor, row);
    if (row.status === 'dismissed') return row;

    await this.db.transaction(async (tx) => {
      await tx
        .update(insightRows)
        .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: actor.userId })
        .where(eq(insightRows.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'insight.dismiss',
        entityType: 'insight',
        entityId: id,
        detail: { rule: row.rule, title: row.title },
      });
    });
    return this.raw(id);
  }

  async restore(actor: Actor, id: string) {
    await this.require(actor, 'insights.write');
    await this.assertVisible(actor, await this.raw(id));
    await this.db
      .update(insightRows)
      .set({ status: 'open', dismissedAt: null, dismissedBy: null })
      .where(eq(insightRows.id, id));
    return this.raw(id);
  }

  /** Counts for the overview badge, without shipping every row. */
  async summary(actor: Actor) {
    await this.require(actor, 'insights.read');
    const open = await this.list(actor, { status: 'open' });
    return {
      total: open.length,
      urgent: open.filter((i) => i.severity === 'urgent').length,
      attention: open.filter((i) => i.severity === 'attention').length,
      info: open.filter((i) => i.severity === 'info').length,
      top: open.slice(0, 5),
    };
  }

  /**
   * Refuse to act on an insight raised about somebody else.
   *
   * `list` hides those, but an id is guessable and `dismiss` took one directly — so without
   * this a colleague's personal insight could be silenced by someone who was never allowed
   * to read it, and the person it was for would simply never see it.
   */
  private async assertVisible(
    actor: Actor,
    row: { personId: string | null; audience: string | null },
  ): Promise<void> {
    if (await this.permissions.can(actor, 'insights.read_all')) return;
    if (row.personId) {
      if (row.personId === actor.userId) return;
      await this.require(actor, 'insights.read_all');
      return;
    }
    // Addressed to a department: anyone in it may say "I know" on the department's behalf.
    const mine = await this.departments.keysFor(actor.userId);
    if (row.audience && mine.includes(row.audience)) return;
    await this.require(actor, 'insights.read_all');
  }

  private async raw(id: string) {
    const [row] = await this.db.select().from(insightRows).where(eq(insightRows.id, id)).limit(1);
    if (!row) throw new NotFoundException('Insight not found');
    return row;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }
}
