import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import {
  CONTRACT_TYPES,
  contracts,
  rateCardLines,
  rateCards,
} from './contracts.schema.js';

export interface CreateContractInput {
  clientId: string;
  projectId?: string | null;
  type: (typeof CONTRACT_TYPES)[number];
  title: string;
  reference?: string | null;
  documentId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  noticeDays?: number | null;
  autoRenews?: 'yes' | 'no';
  renewalMonths?: number | null;
  allowsSubProcessors?: 'yes' | 'no' | 'unclear' | null;
  notes?: string | null;
}

export interface RateCardLineInput {
  role: string;
  rateCents: number;
  effectiveFrom: string;
}

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);

/**
 * Contracts and rate cards (Phase 5b).
 *
 * The register answers "what have we agreed, and when does it lapse?". Rate cards record
 * what an hour costs and since when — but they do not change what an invoice bills on
 * their own (decision D1): applying a rate to a project is an explicit act you confirm,
 * so a rate card edit can never quietly alter a draft invoice.
 */
@Injectable()
export class ContractsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly crm: CrmService,
  ) {}

  // ── contracts ──────────────────────────────────────────────

  async create(actor: Actor, input: CreateContractInput) {
    await this.require(actor, 'sales.contracts.write');
    if (!input.title?.trim()) throw new BadRequestException('A contract needs a title');
    if (!CONTRACT_TYPES.includes(input.type)) {
      throw new BadRequestException(`Unknown contract type '${input.type}'`);
    }
    await this.crm.getClient(actor, input.clientId); // exists and is readable

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'contract',
        displayName: input.title.trim(),
        urlPath: `/money/contracts/${id}`,
      });

      await tx.insert(contracts).values({
        id,
        clientId: input.clientId,
        projectId: input.projectId ?? null,
        type: input.type,
        title: input.title.trim(),
        reference: input.reference ?? null,
        documentId: input.documentId ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        noticeDays: input.noticeDays ?? null,
        autoRenews: input.autoRenews ?? 'no',
        renewalMonths: input.renewalMonths ?? null,
        allowsSubProcessors: input.allowsSubProcessors ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });

      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.clientId,
        kind: 'contracted_with',
      });
      if (input.documentId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.documentId,
          kind: 'signed_document',
        });
      }
      if (input.projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.projectId,
          kind: 'governs',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contract.create',
        entityType: 'contract',
        entityId: id,
        detail: { type: input.type, clientId: input.clientId },
      });
    });

    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, patch: Partial<CreateContractInput>) {
    await this.require(actor, 'sales.contracts.write');
    const before = await this.raw(id);
    if (before.signedAt) {
      throw new BadRequestException(
        'A signed contract cannot be edited — its terms are what a dispute turns on. Record an amendment as a new contract.',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(contracts)
        .set({
          title: patch.title?.trim() ?? before.title,
          type: patch.type ?? before.type,
          reference: patch.reference === undefined ? before.reference : patch.reference,
          documentId: patch.documentId === undefined ? before.documentId : patch.documentId,
          startsOn: patch.startsOn === undefined ? before.startsOn : patch.startsOn,
          endsOn: patch.endsOn === undefined ? before.endsOn : patch.endsOn,
          noticeDays: patch.noticeDays === undefined ? before.noticeDays : patch.noticeDays,
          autoRenews: patch.autoRenews ?? before.autoRenews,
          renewalMonths:
            patch.renewalMonths === undefined ? before.renewalMonths : patch.renewalMonths,
          allowsSubProcessors:
            patch.allowsSubProcessors === undefined
              ? before.allowsSubProcessors
              : patch.allowsSubProcessors,
          notes: patch.notes === undefined ? before.notes : patch.notes,
          projectId: patch.projectId === undefined ? before.projectId : patch.projectId,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, id));

      if (patch.documentId && patch.documentId !== before.documentId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: patch.documentId,
          kind: 'signed_document',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contract.update',
        entityType: 'contract',
        entityId: id,
      });
    });

    return this.get(actor, id);
  }

  /** Signing freezes the commercial terms — by trigger as well as here. */
  async sign(actor: Actor, id: string) {
    await this.require(actor, 'sales.contracts.write');
    const contract = await this.raw(id);
    if (contract.signedAt) throw new BadRequestException('This contract is already signed');
    if (!contract.startsOn) {
      throw new BadRequestException('A signed contract needs a start date');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(contracts)
        .set({ status: 'signed', signedAt: new Date(), updatedAt: new Date() })
        .where(eq(contracts.id, id));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contract.sign',
        entityType: 'contract',
        entityId: id,
        detail: { type: contract.type, endsOn: contract.endsOn },
      });

      await this.events.publish(tx, {
        name: 'contract.signed',
        entityType: 'contract',
        entityId: id,
        actorId: actor.userId,
        payload: {
          clientId: contract.clientId,
          type: contract.type,
          startsOn: contract.startsOn,
          endsOn: contract.endsOn,
        },
      });
    });

    return this.get(actor, id);
  }

  async terminate(actor: Actor, id: string, reason?: string) {
    await this.require(actor, 'sales.contracts.write');
    const contract = await this.raw(id);
    if (!contract.signedAt) throw new BadRequestException('Only signed contracts can be terminated');
    if (contract.terminatedAt) throw new BadRequestException('This contract is already terminated');

    await this.db.transaction(async (tx) => {
      await tx
        .update(contracts)
        .set({ status: 'terminated', terminatedAt: new Date(), updatedAt: new Date() })
        .where(eq(contracts.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contract.terminate',
        entityType: 'contract',
        entityId: id,
        detail: { reason: reason ?? null },
      });
    });

    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string) {
    await this.require(actor, 'sales.contracts.write');
    const contract = await this.raw(id);
    if (contract.signedAt) {
      throw new BadRequestException('A signed contract cannot be deleted — terminate it instead');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(contracts).where(eq(contracts.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contract.delete',
        entityType: 'contract',
        entityId: id,
      });
    });
  }

  async list(actor: Actor, filter: { clientId?: string; type?: string; status?: string } = {}) {
    await this.require(actor, 'sales.contracts.read');
    const where = [
      filter.clientId ? eq(contracts.clientId, filter.clientId) : undefined,
      filter.type ? eq(contracts.type, filter.type) : undefined,
      filter.status ? eq(contracts.status, filter.status) : undefined,
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(contracts)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(contracts.createdAt));

    return rows.map((row) => this.decorate(row));
  }

  async get(actor: Actor, id: string) {
    await this.require(actor, 'sales.contracts.read');
    return this.decorate(await this.raw(id));
  }

  /**
   * The dates that matter, worked out from today.
   *
   * Derived rather than stored, like `overdue` on invoices and `expired` on quotes: a
   * contract must not silently change state because a date passed while nobody looked.
   * The `contract.expiring` event needs something to notice the day it becomes true, and
   * that belongs to Phase 6's insight service (brief §3, D3).
   */
  private decorate(row: typeof contracts.$inferSelect) {
    const now = today();
    const active = row.status === 'signed';
    const daysUntilEnd = row.endsOn ? daysBetween(now, row.endsOn) : null;

    // The last day notice can still be given and take effect before the end date.
    const noticeDeadline =
      row.endsOn && row.noticeDays != null
        ? new Date(new Date(row.endsOn).getTime() - row.noticeDays * DAY_MS)
            .toISOString()
            .slice(0, 10)
        : null;

    return {
      ...row,
      expired: active && daysUntilEnd != null && daysUntilEnd < 0,
      daysUntilEnd,
      noticeDeadline,
      /** True while notice can still be given, but the window is closing. */
      inNoticeWindow:
        active && noticeDeadline != null && noticeDeadline >= now && daysUntilEnd! >= 0,
      /** The one worth a badge: notice must be given soon or the contract rolls over. */
      noticeClosingSoon:
        active &&
        noticeDeadline != null &&
        noticeDeadline >= now &&
        daysBetween(now, noticeDeadline) <= 30,
      expiringSoon: active && daysUntilEnd != null && daysUntilEnd >= 0 && daysUntilEnd <= 60,
    };
  }

  // ── rate cards ─────────────────────────────────────────────

  async createRateCard(
    actor: Actor,
    input: { clientId?: string | null; contractId?: string | null; name: string; lines?: RateCardLineInput[] },
  ) {
    await this.require(actor, 'sales.contracts.write');
    if (!input.name?.trim()) throw new BadRequestException('A rate card needs a name');

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(rateCards).values({
        id,
        clientId: input.clientId ?? null,
        contractId: input.contractId ?? null,
        name: input.name.trim(),
        createdBy: actor.userId,
      });
      if (input.lines?.length) {
        await tx.insert(rateCardLines).values(
          input.lines.map((line) => ({
            id: this.registry.newId(),
            rateCardId: id,
            role: line.role,
            rateCents: line.rateCents,
            effectiveFrom: line.effectiveFrom,
          })),
        );
      }
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'rate_card.create',
        entityType: 'rate_card',
        entityId: id,
        detail: { name: input.name, clientId: input.clientId ?? null },
      });
    });

    return this.getRateCard(actor, id);
  }

  /**
   * Add a rate, which is how an indexation is recorded.
   *
   * Existing lines are never rewritten: last year's rate stays visible, because the
   * question "what were we charging in 2025?" has to keep having an answer.
   */
  async addRate(actor: Actor, rateCardId: string, line: RateCardLineInput) {
    await this.require(actor, 'sales.contracts.write');
    await this.getRateCard(actor, rateCardId);
    if (line.rateCents <= 0) throw new BadRequestException('A rate must be positive');

    await this.db.transaction(async (tx) => {
      await tx
        .insert(rateCardLines)
        .values({
          id: this.registry.newId(),
          rateCardId,
          role: line.role,
          rateCents: line.rateCents,
          effectiveFrom: line.effectiveFrom,
        })
        .onConflictDoUpdate({
          target: [rateCardLines.rateCardId, rateCardLines.role, rateCardLines.effectiveFrom],
          set: { rateCents: line.rateCents },
        });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'rate_card.add_rate',
        entityType: 'rate_card',
        entityId: rateCardId,
        detail: { role: line.role, rateCents: line.rateCents, from: line.effectiveFrom },
      });
    });

    return this.getRateCard(actor, rateCardId);
  }

  async removeRate(actor: Actor, rateCardId: string, lineId: string) {
    await this.require(actor, 'sales.contracts.write');
    await this.db.delete(rateCardLines).where(eq(rateCardLines.id, lineId));
    return this.getRateCard(actor, rateCardId);
  }

  async listRateCards(actor: Actor, clientId?: string) {
    await this.require(actor, 'sales.contracts.read');
    const rows = await this.db
      .select()
      .from(rateCards)
      .where(
        clientId
          ? or(eq(rateCards.clientId, clientId), isNull(rateCards.clientId))
          : undefined,
      )
      .orderBy(asc(rateCards.name));
    return Promise.all(rows.map((row) => this.withLines(row)));
  }

  async getRateCard(actor: Actor, id: string) {
    await this.require(actor, 'sales.contracts.read');
    const [row] = await this.db.select().from(rateCards).where(eq(rateCards.id, id)).limit(1);
    if (!row) throw new NotFoundException('Rate card not found');
    return this.withLines(row);
  }

  private async withLines(card: typeof rateCards.$inferSelect) {
    const lines = await this.db
      .select()
      .from(rateCardLines)
      .where(eq(rateCardLines.rateCardId, card.id))
      .orderBy(asc(rateCardLines.role), desc(rateCardLines.effectiveFrom));

    // Roles with the rate currently in force, so the card reads as "what we charge now".
    const current = new Map<string, (typeof lines)[number]>();
    const now = today();
    for (const line of lines) {
      if (line.effectiveFrom <= now && !current.has(line.role)) current.set(line.role, line);
    }
    return { ...card, lines, currentRates: [...current.values()] };
  }

  /**
   * The rate for a role on a given date.
   *
   * Invoicing does NOT call this (decision D1): the project rate is authoritative, and a
   * rate card edit must never quietly change what a draft invoice bills. It exists and is
   * tested because it is the whole of what option B would need — making date-based
   * lookup a small change later rather than a rewrite.
   */
  async rateOn(rateCardId: string, role: string, on: string): Promise<number | null> {
    const [line] = await this.db
      .select()
      .from(rateCardLines)
      .where(
        and(
          eq(rateCardLines.rateCardId, rateCardId),
          eq(rateCardLines.role, role),
          lte(rateCardLines.effectiveFrom, on),
        ),
      )
      .orderBy(desc(rateCardLines.effectiveFrom))
      .limit(1);
    return line?.rateCents ?? null;
  }

  /**
   * Apply a rate to a project — the explicit act decision D1 chose over automatic lookup.
   *
   * This is the same seam accepting a quote uses: one number lands on the project, and
   * invoicing keeps reading exactly one number.
   */
  async applyRateToProject(
    actor: Actor,
    input: { projectId: string; rateCardId: string; role: string; on?: string },
  ) {
    await this.require(actor, 'sales.contracts.write');
    const on = input.on ?? today();
    const rateCents = await this.rateOn(input.rateCardId, input.role, on);
    if (rateCents == null) {
      throw new BadRequestException(`No rate for '${input.role}' in force on ${on}`);
    }

    const project = await this.crm.updateProject(actor, input.projectId, {
      defaultRateCents: rateCents,
    });

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'rate_card.apply',
        entityType: 'project',
        entityId: input.projectId,
        detail: { rateCardId: input.rateCardId, role: input.role, rateCents, on },
      });
    });

    return project;
  }

  // ── internals ──────────────────────────────────────────────

  private async raw(id: string) {
    const [row] = await this.db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    if (!row) throw new NotFoundException('Contract not found');
    return row;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }

  /** DROP then CREATE — see TimeService for the boot failure that taught us this. */
  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS sales.v_contracts CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW sales.v_contracts AS
      SELECT c.id, c.client_id, c.project_id, c.type, c.status, c.title,
             c.starts_on, c.ends_on, c.notice_days, c.auto_renews, c.renewal_months,
             c.allows_sub_processors, c.document_id,
             (c.ends_on - CURRENT_DATE) AS days_until_end,
             (c.status = 'signed' AND c.ends_on IS NOT NULL AND c.ends_on < CURRENT_DATE) AS expired,
             c.signed_at, c.terminated_at, c.created_at
        FROM sales.contracts c
    `);
  }
}
