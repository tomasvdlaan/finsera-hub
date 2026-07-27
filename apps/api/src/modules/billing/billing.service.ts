import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { orgSettings, users } from '../../core/db/core.schema.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { CrmService } from '../crm/crm.service.js';
import { TimeService } from '../time/time.service.js';
import { invoiceCounters, invoiceLines, invoices } from './billing.schema.js';
import {
  computeTotals,
  rateForTreatment,
  vatLegend,
  type Totals,
  type VatTreatment,
} from './vat.js';

export interface DraftLineInput {
  description: string;
  quantity: string; // exact decimal string
  unitPriceCents: number;
  sourceEntryIds?: string[];
}

/**
 * Invoicing (Phase 5c).
 *
 * Drafts are cheap and editable. Issue is the moment an invoice becomes a legal
 * document: the number is allocated, the VAT position is validated and snapshotted, and
 * the row becomes immutable — enforced by a database trigger, not by this service's
 * good manners.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly crm: CrmService,
    private readonly time: TimeService,
  ) {}

  // ── drafts ─────────────────────────────────────────────────

  /**
   * Draft an invoice from submitted, billable, not-yet-billed hours on a project.
   *
   * One line per person: the client reads "consultancy, name, hours × rate", which is
   * defensible and stable. Entry ids are recorded on the line so an hour can never be
   * billed twice.
   */
  async draftFromHours(actor: Actor, projectId: string, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'billing.write');
    const project = await this.crm.getProject(actor, projectId);
    if (project.defaultRateCents == null) {
      throw new BadRequestException('The project has no hourly rate — set one before invoicing');
    }

    const entries = await this.time.entriesForBilling(projectId);
    const billed = await this.billedEntryIds();
    const open = entries.filter((entry) => !billed.has(entry.id));
    if (open.length === 0) {
      throw new BadRequestException('No submitted, unbilled hours on this project');
    }

    // Group per person, in a stable order.
    const byPerson = new Map<string, { minutes: number; ids: string[] }>();
    for (const entry of open) {
      const group = byPerson.get(entry.personId) ?? { minutes: 0, ids: [] };
      group.minutes += entry.minutes ?? 0;
      group.ids.push(entry.id);
      byPerson.set(entry.personId, group);
    }

    const names = new Map(
      (await this.db.select({ id: users.id, name: users.displayName }).from(users)).map((u) => [
        u.id,
        u.name,
      ]),
    );

    const lines: DraftLineInput[] = [...byPerson.entries()].map(([personId, group]) => ({
      description: `Consultancy — ${names.get(personId) ?? 'team'}`,
      quantity: (group.minutes / 60).toFixed(2),
      unitPriceCents: project.defaultRateCents!,
      sourceEntryIds: group.ids,
    }));

    return this.createDraft(
      actor,
      { clientId: project.clientId, projectId, lines },
      origin,
    );
  }

  async createDraft(
    actor: Actor,
    input: { clientId: string; projectId?: string | null; lines: DraftLineInput[]; notes?: string },
    origin: { aiInitiated?: boolean } = {},
  ) {
    await this.require(actor, 'billing.write');
    if (!input.lines?.length) throw new BadRequestException('An invoice needs at least one line');

    const client = await this.crm.getClient(actor, input.clientId);
    const treatment = client.vatTreatment as VatTreatment;
    const rate = rateForTreatment(treatment);
    const totals = computeTotals(
      input.lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: rate })),
    );

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'invoice',
        displayName: `Draft invoice — ${client.name}`,
        urlPath: `/billing/invoices/${id}`,
      });

      await tx.insert(invoices).values({
        id,
        kind: 'invoice',
        clientId: input.clientId,
        projectId: input.projectId ?? null,
        vatTreatment: treatment,
        subtotalCents: totals.subtotalCents,
        vatCents: totals.vatCents,
        totalCents: totals.totalCents,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });

      await this.insertLines(tx, id, input.lines, rate);

      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.clientId,
        kind: 'billed_to',
      });
      if (input.projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.projectId,
          kind: 'bills',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'invoice.draft',
        entityType: 'invoice',
        entityId: id,
        detail: { clientId: input.clientId, totalCents: totals.totalCents },
        aiInitiated: origin.aiInitiated ?? false,
      });
    });

    return this.getInvoice(actor, id);
  }

  /** Replace a draft's lines. Refused for issued invoices by the trigger regardless. */
  async updateDraftLines(actor: Actor, id: string, lines: DraftLineInput[]) {
    await this.require(actor, 'billing.write');
    const invoice = await this.rawInvoice(id);
    if (invoice.issuedAt) throw new BadRequestException('Issued invoices are immutable — use a credit note');
    if (!lines.length) throw new BadRequestException('An invoice needs at least one line');

    const rate = rateForTreatment(invoice.vatTreatment as VatTreatment);
    const totals = computeTotals(
      lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: rate })),
    );

    await this.db.transaction(async (tx) => {
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await this.insertLines(tx, id, lines, rate);
      await tx
        .update(invoices)
        .set({
          subtotalCents: totals.subtotalCents,
          vatCents: totals.vatCents,
          totalCents: totals.totalCents,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: id,
        detail: { totalCents: totals.totalCents },
      });
    });

    return this.getInvoice(actor, id);
  }

  // ── issue: the legal moment ────────────────────────────────

  async issue(actor: Actor, id: string) {
    await this.require(actor, 'billing.issue');
    const invoice = await this.rawInvoice(id);
    if (invoice.issuedAt) throw new BadRequestException('Already issued');
    if (invoice.status === 'void') throw new BadRequestException('This draft was voided');

    const client = await this.crm.getClient(actor, invoice.clientId);
    const treatment = invoice.vatTreatment as VatTreatment;

    // Reverse charge without the client's VAT number is not a valid invoice (brief §4).
    if (treatment === 'reverse_charge' && !client.vatNumber) {
      throw new BadRequestException(
        'Reverse charge requires the client’s VAT number — add it to the client first',
      );
    }

    const lineCount = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id));
    if (Number(lineCount[0]?.n ?? 0) === 0) {
      throw new BadRequestException('An invoice needs at least one line');
    }

    const today = new Date().toISOString().slice(0, 10);
    const terms = client.paymentTermsDays ?? 30;
    const due = new Date(Date.now() + terms * 86_400_000).toISOString().slice(0, 10);

    let number = '';
    await this.db.transaction(async (tx) => {
      number = await this.allocateNumber(tx, new Date().getFullYear());

      await tx
        .update(invoices)
        .set({
          number,
          status: 'issued',
          issuedAt: new Date(),
          issueDate: today,
          dueOn: due,
          clientVatNumber: client.vatNumber ?? null,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));

      await this.registry.updateDisplay(tx, id, {
        displayName: `${invoice.kind === 'credit_note' ? 'Credit note' : 'Invoice'} ${number} — ${client.name}`,
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'invoice.issue',
        entityType: 'invoice',
        entityId: id,
        detail: { number, totalCents: invoice.totalCents, vatTreatment: treatment },
      });

      await this.events.publish(tx, {
        name: 'invoice.issued',
        entityType: 'invoice',
        entityId: id,
        actorId: actor.userId,
        payload: { number, clientId: invoice.clientId, totalCents: invoice.totalCents },
      });
    });

    return this.getInvoice(actor, id);
  }

  /**
   * Sequential, gapless numbering (brief §5): one counter row per year, locked FOR
   * UPDATE inside the issuing transaction, so concurrent issues serialise rather than
   * collide. The unique index on the number is the backstop that turns any bug into a
   * failed transaction instead of two invoices sharing a number.
   */
  private async allocateNumber(tx: Tx, year: number): Promise<string> {
    await tx
      .insert(invoiceCounters)
      .values({ year, lastNumber: 0 })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(invoiceCounters)
      .where(eq(invoiceCounters.year, year))
      .for('update');
    const next = (row?.lastNumber ?? 0) + 1;
    await tx
      .update(invoiceCounters)
      .set({ lastNumber: next })
      .where(eq(invoiceCounters.year, year));

    const [settings] = await tx.select().from(orgSettings).limit(1);
    const prefix = settings?.invoiceNumberPrefix ?? '';
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  // ── after issue ────────────────────────────────────────────

  async markPaid(actor: Actor, id: string) {
    await this.require(actor, 'billing.write');
    const invoice = await this.rawInvoice(id);
    if (!invoice.issuedAt) throw new BadRequestException('Only issued invoices can be paid');

    await this.db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'invoice.paid',
        entityType: 'invoice',
        entityId: id,
        detail: { number: invoice.number },
      });
      await this.events.publish(tx, {
        name: 'invoice.paid',
        entityType: 'invoice',
        entityId: id,
        actorId: actor.userId,
        payload: { number: invoice.number, totalCents: invoice.totalCents },
      });
    });
    return this.getInvoice(actor, id);
  }

  /** Void a DRAFT. Issued invoices are corrected by credit note, never voided away. */
  async voidDraft(actor: Actor, id: string) {
    await this.require(actor, 'billing.write');
    const invoice = await this.rawInvoice(id);
    if (invoice.issuedAt) {
      throw new BadRequestException('Issued invoices cannot be voided — create a credit note');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({ status: 'void', updatedAt: new Date() })
        .where(eq(invoices.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'invoice.void',
        entityType: 'invoice',
        entityId: id,
      });
    });
  }

  /**
   * A credit note reverses an issued invoice: same lines, negated, referencing the
   * original. It is itself an invoice-kind document and takes the next number in the
   * same sequence when issued.
   */
  async createCreditNote(actor: Actor, invoiceId: string) {
    await this.require(actor, 'billing.write');
    const original = await this.rawInvoice(invoiceId);
    if (!original.issuedAt) throw new BadRequestException('Only issued invoices can be credited');

    const originalLines = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.position));

    const client = await this.crm.getClient(actor, original.clientId);
    const rate = rateForTreatment(original.vatTreatment as VatTreatment);
    const negated: DraftLineInput[] = originalLines.map((l) => ({
      description: `Credit — ${l.description}`,
      quantity: l.quantity,
      unitPriceCents: -l.unitPriceCents,
      sourceEntryIds: [],
    }));
    const totals = computeTotals(
      negated.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: rate })),
    );

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'invoice',
        displayName: `Draft credit note — ${client.name}`,
        urlPath: `/billing/invoices/${id}`,
      });
      await tx.insert(invoices).values({
        id,
        kind: 'credit_note',
        clientId: original.clientId,
        projectId: original.projectId,
        creditsInvoiceId: invoiceId,
        vatTreatment: original.vatTreatment,
        subtotalCents: totals.subtotalCents,
        vatCents: totals.vatCents,
        totalCents: totals.totalCents,
        createdBy: actor.userId,
      });
      await this.insertLines(tx, id, negated, rate);
      await this.links.createWithin(tx, actor, { fromId: id, toId: invoiceId, kind: 'credits' });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'credit_note.draft',
        entityType: 'invoice',
        entityId: id,
        detail: { credits: original.number },
      });
    });

    return this.getInvoice(actor, id);
  }

  // ── reading ────────────────────────────────────────────────

  async listInvoices(actor: Actor, filter: { clientId?: string; status?: string } = {}) {
    await this.require(actor, 'billing.read');
    const where = [ne(invoices.status, 'void')];
    if (filter.clientId) where.push(eq(invoices.clientId, filter.clientId));
    if (filter.status) where.push(eq(invoices.status, filter.status));

    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(...where))
      .orderBy(desc(invoices.createdAt))
      .limit(200);

    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => ({
      ...r,
      overdue: r.status === 'issued' && r.dueOn != null && r.dueOn < today,
    }));
  }

  async getInvoice(actor: Actor, id: string) {
    await this.require(actor, 'billing.read');
    const invoice = await this.rawInvoice(id);
    const lines = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.position));

    const today = new Date().toISOString().slice(0, 10);
    return {
      ...invoice,
      lines,
      overdue: invoice.status === 'issued' && invoice.dueOn != null && invoice.dueOn < today,
      vatLegend: vatLegend(invoice.vatTreatment as VatTreatment),
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async insertLines(tx: Tx, invoiceId: string, lines: DraftLineInput[], rate: string) {
    await tx.insert(invoiceLines).values(
      lines.map((line, i) => {
        const totals: Totals = computeTotals([
          { quantity: line.quantity, unitPriceCents: line.unitPriceCents, vatRate: rate },
        ]);
        return {
          id: this.registry.newId(),
          invoiceId,
          position: i + 1,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          amountCents: totals.subtotalCents,
          vatRate: rate,
          sourceEntryIds: line.sourceEntryIds ?? [],
        };
      }),
    );
  }

  /** Entry ids already on any non-void invoice — the guard against billing an hour twice. */
  private async billedEntryIds(): Promise<Set<string>> {
    const rows = await this.db
      .select({ ids: invoiceLines.sourceEntryIds, status: invoices.status })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(ne(invoices.status, 'void'));
    const set = new Set<string>();
    for (const row of rows) for (const id of row.ids as string[]) set.add(id);
    return set;
  }

  private async rawInvoice(id: string) {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS billing.v_invoices CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW billing.v_invoices AS
      SELECT i.id, i.kind, i.number, i.status, i.client_id, i.project_id,
             i.vat_treatment, i.subtotal_cents, i.vat_cents, i.total_cents,
             i.issue_date, i.due_on, i.paid_at, i.created_at,
             (i.status = 'issued' AND i.due_on < CURRENT_DATE) AS overdue
        FROM billing.invoices i
       WHERE i.status <> 'void'
    `);
  }
}
