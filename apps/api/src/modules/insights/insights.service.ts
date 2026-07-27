import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
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
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

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
        await this.db.insert(insightRows).values({
          id: this.registry.newId(),
          key: c.key,
          rule: c.rule,
          subjectId: c.subjectId,
          subjectType: c.subjectType,
          severity: c.severity,
          title: c.title,
          detail: c.detail,
          facts: c.facts,
          magnitude: c.magnitude,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        raised++;
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
          lastSeenAt: now,
          // A resolved insight whose condition returned is open again.
          status: existing.status === 'resolved' ? 'open' : existing.status,
          resolvedAt: existing.status === 'resolved' ? null : existing.resolvedAt,
        })
        .where(eq(insightRows.id, existing.id));
      refreshed++;
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

    return { raised, refreshed, resolved: stale.length };
  }

  async list(actor: Actor, filter: { status?: string; rule?: string } = {}) {
    await this.require(actor, 'insights.read');
    const where = [
      eq(insightRows.status, filter.status ?? 'open'),
      filter.rule ? eq(insightRows.rule, filter.rule) : undefined,
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
