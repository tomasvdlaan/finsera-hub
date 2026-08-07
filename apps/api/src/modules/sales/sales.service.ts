import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { SettingsService } from '../../core/settings/settings.service.js';
import {
  computeTotals,
  rateForTreatment,
  vatLegend,
  type VatTreatment,
} from '../../core/money/vat.js';
import { CrmService } from '../crm/crm.service.js';
import { DocsService } from '../docs/docs.service.js';
import { renderQuotePdf, type RenderableQuote } from './quote-render.js';
import { quoteCounters, quoteLines, quotes } from './sales.schema.js';

export interface QuoteLineInput {
  description: string;
  quantity: string; // exact decimal string
  unitPriceCents: number;
  unit?: 'hours' | 'fixed' | 'days';
}

export interface CreateQuoteInput {
  clientId: string;
  projectId?: string | null;
  title: string;
  introduction?: string | null;
  notes?: string | null;
  lines: QuoteLineInput[];
  hourlyRateCents?: number | null;
  billingModel?: 'time_and_materials' | 'fixed_fee' | 'retainer';
  validUntil?: string | null;
}

/**
 * Quotation (Phase 5a).
 *
 * Drafts are free. Sending is the moment a quote becomes a promise: it gets its number,
 * its PDF is filed, and the row freezes — enforced by trigger. Negotiating after that
 * produces a revision, so the version the client agreed to stays reproducible.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly crm: CrmService,
    private readonly docs: DocsService,
    private readonly settings: SettingsService,
  ) {}

  // ── drafts ─────────────────────────────────────────────────

  async createDraft(actor: Actor, input: CreateQuoteInput, origin: { aiInitiated?: boolean } = {}) {
    await this.require(actor, 'sales.quotes.write');
    if (!input.lines?.length) throw new BadRequestException('A quote needs at least one line');
    if (!input.title?.trim()) throw new BadRequestException('A quote needs a title');

    const client = await this.crm.getClient(actor, input.clientId);
    const treatment = client.vatTreatment as VatTreatment;
    const rate = rateForTreatment(treatment);
    const totals = computeTotals(
      input.lines.map((l) => ({
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        vatRate: rate,
      })),
    );

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'quote',
        displayName: `Draft quote — ${input.title}`,
        urlPath: `/money/quotes/${id}`,
      });

      await tx.insert(quotes).values({
        id,
        clientId: input.clientId,
        projectId: input.projectId ?? null,
        title: input.title.trim(),
        introduction: input.introduction ?? null,
        notes: input.notes ?? null,
        vatTreatment: treatment,
        subtotalCents: totals.subtotalCents,
        vatCents: totals.vatCents,
        totalCents: totals.totalCents,
        hourlyRateCents: input.hourlyRateCents ?? this.inferHourlyRate(input.lines),
        billingModel: input.billingModel ?? 'time_and_materials',
        validUntil: input.validUntil ?? this.defaultValidUntil(),
        createdBy: actor.userId,
      });

      await this.insertLines(tx, id, input.lines, rate);

      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.clientId,
        kind: 'quoted_to',
      });
      if (input.projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: input.projectId,
          kind: 'quotes_for',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.draft',
        entityType: 'quote',
        entityId: id,
        detail: { clientId: input.clientId, totalCents: totals.totalCents },
        aiInitiated: origin.aiInitiated ?? false,
      });
    });

    return this.getQuote(actor, id);
  }

  /** Replace a draft's lines. Refused for sent quotes by the trigger regardless. */
  async updateDraftLines(actor: Actor, id: string, lines: QuoteLineInput[]) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (quote.sentAt) {
      throw new BadRequestException('Sent quotes are immutable — create a revision instead');
    }
    if (!lines.length) throw new BadRequestException('A quote needs at least one line');

    const rate = rateForTreatment(quote.vatTreatment as VatTreatment);
    const totals = computeTotals(
      lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatRate: rate })),
    );

    await this.db.transaction(async (tx) => {
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, id));
      await this.insertLines(tx, id, lines, rate);
      await tx
        .update(quotes)
        .set({
          subtotalCents: totals.subtotalCents,
          vatCents: totals.vatCents,
          totalCents: totals.totalCents,
          hourlyRateCents: quote.hourlyRateCents ?? this.inferHourlyRate(lines),
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.update',
        entityType: 'quote',
        entityId: id,
        detail: { totalCents: totals.totalCents, lines: lines.length },
      });
    });

    return this.getQuote(actor, id);
  }

  /** Edit a draft's header fields. Sent quotes are refused, same as lines. */
  async updateDraft(actor: Actor, id: string, patch: Partial<CreateQuoteInput>) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (quote.sentAt) {
      throw new BadRequestException('Sent quotes are immutable — create a revision instead');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({
          title: patch.title?.trim() ?? quote.title,
          introduction:
            patch.introduction === undefined ? quote.introduction : patch.introduction,
          notes: patch.notes === undefined ? quote.notes : patch.notes,
          hourlyRateCents:
            patch.hourlyRateCents === undefined ? quote.hourlyRateCents : patch.hourlyRateCents,
          billingModel: patch.billingModel ?? quote.billingModel,
          validUntil: patch.validUntil === undefined ? quote.validUntil : patch.validUntil,
          projectId: patch.projectId === undefined ? quote.projectId : patch.projectId,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.update',
        entityType: 'quote',
        entityId: id,
      });
    });

    return this.getQuote(actor, id);
  }

  async deleteDraft(actor: Actor, id: string) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (quote.sentAt) {
      throw new BadRequestException('Sent quotes cannot be deleted — reject it instead');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(quotes).where(eq(quotes.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.delete',
        entityType: 'quote',
        entityId: id,
      });
    });
  }

  // ── sending ────────────────────────────────────────────────

  /**
   * Send: allocate the number, freeze the quote, file the PDF.
   *
   * "Send" here means "this is now the version the client has" — the email is still
   * yours to write, per the brief. What matters is that the document stops moving.
   */
  async send(actor: Actor, id: string) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (quote.sentAt) throw new BadRequestException('This quote has already been sent');

    const lines = await this.linesFor(id);
    if (lines.length === 0) throw new BadRequestException('A quote needs at least one line');
    if (quote.billingModel === 'time_and_materials' && quote.hourlyRateCents == null) {
      throw new BadRequestException(
        'A time-and-materials quote needs an hourly rate — it becomes the project rate when accepted',
      );
    }

    const org = await this.settings.get();
    if (!this.settings.isReadyForInvoicing(org)) {
      throw new BadRequestException(
        'Fill in the organisation details (legal name, KvK, BTW, IBAN) before sending — they print on the quote',
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    let number = '';

    await this.db.transaction(async (tx) => {
      number = await this.allocateNumber(tx, new Date().getFullYear());

      await tx
        .update(quotes)
        .set({
          number,
          status: 'sent',
          sentAt: new Date(),
          issueDate: today,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));

      await this.registry.updateDisplay(tx, id, {
        displayName: `Quote ${number} — ${quote.title}`,
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.send',
        entityType: 'quote',
        entityId: id,
        detail: { number, totalCents: quote.totalCents },
      });

      await this.events.publish(tx, {
        name: 'quote.sent',
        entityType: 'quote',
        entityId: id,
        actorId: actor.userId,
        payload: { number, clientId: quote.clientId, totalCents: quote.totalCents },
      });
    });

    await this.renderAndFilePdf(actor, id).catch(() => {
      // The quote is sent regardless; /pdf regenerates from the frozen row.
    });

    return this.getQuote(actor, id);
  }

  /**
   * Sequential numbering. Gaps are FINE here, unlike invoices: no authority audits an
   * abandoned quote. The counter is still locked, so two sends never collide.
   */
  private async allocateNumber(tx: Tx, year: number): Promise<string> {
    await tx.insert(quoteCounters).values({ year, lastNumber: 0 }).onConflictDoNothing();
    const [counter] = await tx
      .select()
      .from(quoteCounters)
      .where(eq(quoteCounters.year, year))
      .for('update');
    const next = (counter?.lastNumber ?? 0) + 1;
    await tx
      .update(quoteCounters)
      .set({ lastNumber: next })
      .where(eq(quoteCounters.year, year));
    return `Q${year}-${String(next).padStart(4, '0')}`;
  }

  // ── decisions ──────────────────────────────────────────────

  /**
   * Accept a quote, optionally creating the project it pays for.
   *
   * The project is OFFERED, not forced: a quote for extra work on an existing project
   * should attach to that project rather than spawn a second one, and only you know
   * which case this is.
   */
  async accept(
    actor: Actor,
    id: string,
    opts: { createProject?: boolean; attachToProjectId?: string } = {},
  ) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (!quote.sentAt) throw new BadRequestException('Only sent quotes can be accepted');
    if (quote.decidedAt) throw new BadRequestException(`This quote is already ${quote.status}`);

    let projectId = opts.attachToProjectId ?? quote.projectId ?? null;

    // Created before the transaction: CrmService owns projects and runs its own.
    if (opts.createProject && !opts.attachToProjectId) {
      const project = await this.crm.createProject(actor, {
        clientId: quote.clientId,
        name: quote.title,
        status: 'active',
        billingModel: quote.billingModel as 'time_and_materials',
        defaultRateCents: quote.hourlyRateCents ?? undefined,
        // The quote total excluding VAT is what the work is worth to the business.
        budgetAmountCents: quote.subtotalCents,
      });
      projectId = project.id;
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({
          status: 'accepted',
          decidedAt: new Date(),
          projectCreatedId: projectId,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));

      if (projectId) {
        await this.links.createWithin(tx, actor, {
          fromId: id,
          toId: projectId,
          kind: 'became_project',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.accept',
        entityType: 'quote',
        entityId: id,
        detail: { number: quote.number, projectId },
      });

      await this.events.publish(tx, {
        name: 'quote.accepted',
        entityType: 'quote',
        entityId: id,
        actorId: actor.userId,
        payload: {
          number: quote.number,
          clientId: quote.clientId,
          projectId,
          totalCents: quote.totalCents,
        },
      });
    });

    return this.getQuote(actor, id);
  }

  /**
   * A client accepting their own quote, from the portal.
   *
   * Separate from `accept` rather than a flag on it, and the signature is the reason:
   * there is no `Actor`. A portal visitor is not an internal identity, and a method that
   * took one would have to be handed a fabricated Actor by the portal — which is exactly
   * the type confusion the portal module is built to make impossible. Instead the caller
   * supplies the client id, and this method proves the quote belongs to it.
   *
   * Ownership is re-checked here rather than trusted from the caller. The portal has
   * already checked it, and that is precisely why this must too: a second caller arriving
   * later would otherwise inherit an unguarded write.
   *
   * No project is created. Internally `accept` can spin one up with a budget taken from
   * the quote, which is a decision about how we run the work — not one a client should
   * make by clicking a button. The internal follow-up attaches a project when it is ready.
   */
  async acceptByClient(input: {
    quoteId: string;
    clientId: string;
    portalUserId: string;
    email: string;
  }) {
    const quote = await this.rawQuote(input.quoteId);

    // One message for every refusal a stranger could probe with: whether a quote exists,
    // belongs to someone else, or was already decided is not a distinction worth leaking.
    const refuse = () => {
      throw new NotFoundException('Not found');
    };

    if (quote.clientId !== input.clientId) refuse();
    if (!quote.sentAt) refuse();
    if (quote.decidedAt) {
      // Except this one: a client re-clicking on a quote they already accepted deserves a
      // sentence rather than a mystery, and they demonstrably already know it exists.
      throw new BadRequestException(`This quote is already ${quote.status}`);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (quote.validUntil && quote.validUntil < today) {
      // The portal marks these expired, so this is the second line of defence rather than
      // the first — but a price that has lapsed must not be claimable by an old browser
      // tab or a crafted request.
      throw new BadRequestException('This quote has expired — please ask us for a new one');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: 'accepted', decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(quotes.id, input.quoteId));

      // actorId is null: the column is a foreign key into core.users and a portal visitor
      // is not one. Who accepted is in the detail, and it is the whole point of the entry.
      await this.audit.record(tx, {
        actorId: null,
        action: 'quote.accept',
        entityType: 'quote',
        entityId: input.quoteId,
        detail: {
          number: quote.number,
          acceptedByPortalUser: input.portalUserId,
          email: input.email,
          viaPortal: true,
        },
      });

      // The same event as an internal acceptance, so anything downstream sees one kind of
      // "a quote was accepted" rather than having to know which door it came through.
      await this.events.publish(tx, {
        name: 'quote.accepted',
        entityType: 'quote',
        entityId: input.quoteId,
        actorId: null,
        payload: {
          number: quote.number,
          clientId: quote.clientId,
          projectId: null,
          totalCents: quote.totalCents,
          viaPortal: true,
        },
      });
    });

    return { id: input.quoteId, number: quote.number, status: 'accepted' as const };
  }

  async reject(actor: Actor, id: string, reason?: string) {
    await this.require(actor, 'sales.quotes.write');
    const quote = await this.rawQuote(id);
    if (!quote.sentAt) throw new BadRequestException('Only sent quotes can be rejected');
    if (quote.decidedAt) throw new BadRequestException(`This quote is already ${quote.status}`);

    await this.db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: 'rejected', decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(quotes.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.reject',
        entityType: 'quote',
        entityId: id,
        detail: { number: quote.number, reason: reason ?? null },
      });
      await this.events.publish(tx, {
        name: 'quote.rejected',
        entityType: 'quote',
        entityId: id,
        actorId: actor.userId,
        payload: { number: quote.number, clientId: quote.clientId, reason: reason ?? null },
      });
    });

    return this.getQuote(actor, id);
  }

  /**
   * Revise a sent quote: a new draft that supersedes it.
   *
   * Not an edit. The client has seen the original, so it stays exactly as it was and the
   * new version carries the chain forward — that is what makes "which one did they agree
   * to?" answerable.
   */
  async revise(actor: Actor, id: string) {
    await this.require(actor, 'sales.quotes.write');
    const original = await this.rawQuote(id);
    if (!original.sentAt) throw new BadRequestException('Only sent quotes need a revision');

    const lines = await this.linesFor(id);
    const newId = this.registry.newId();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id: newId,
        entityType: 'quote',
        displayName: `Draft quote v${original.version + 1} — ${original.title}`,
        urlPath: `/money/quotes/${newId}`,
      });

      await tx.insert(quotes).values({
        id: newId,
        clientId: original.clientId,
        projectId: original.projectId,
        title: original.title,
        introduction: original.introduction,
        notes: original.notes,
        supersedesQuoteId: id,
        version: original.version + 1,
        vatTreatment: original.vatTreatment,
        subtotalCents: original.subtotalCents,
        vatCents: original.vatCents,
        totalCents: original.totalCents,
        hourlyRateCents: original.hourlyRateCents,
        billingModel: original.billingModel,
        validUntil: this.defaultValidUntil(),
        createdBy: actor.userId,
      });

      await this.insertLines(
        tx,
        newId,
        lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          unit: l.unit as QuoteLineInput['unit'],
        })),
        String(lines[0]?.vatRate ?? rateForTreatment(original.vatTreatment as VatTreatment)),
      );

      await this.links.createWithin(tx, actor, {
        fromId: newId,
        toId: id,
        kind: 'supersedes',
      });
      await this.links.createWithin(tx, actor, {
        fromId: newId,
        toId: original.clientId,
        kind: 'quoted_to',
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'quote.revise',
        entityType: 'quote',
        entityId: newId,
        detail: { supersedes: original.number, version: original.version + 1 },
      });
    });

    return this.getQuote(actor, newId);
  }

  // ── documents ──────────────────────────────────────────────

  private async renderAndFilePdf(actor: Actor, id: string): Promise<void> {
    const renderable = await this.renderable(actor, id);
    const org = await this.settings.get();
    const pdf = await renderQuotePdf(renderable, org);
    const quote = await this.rawQuote(id);

    const document = await this.docs.upload(actor, {
      filename: `offerte-${renderable.number}.pdf`,
      mimeType: 'application/pdf',
      data: pdf,
      title: `Offerte ${renderable.number} — ${renderable.title}`,
      clientId: quote.clientId,
      category: 'quote',
    });

    await this.db
      .update(quotes)
      .set({ pdfDocumentId: document.id, updatedAt: new Date() })
      .where(eq(quotes.id, id));
  }

  /** The stored original for sent quotes; a live CONCEPT render for drafts. */
  async getPdf(actor: Actor, id: string): Promise<{ filename: string; data: Buffer }> {
    await this.require(actor, 'sales.quotes.read');
    const quote = await this.rawQuote(id);

    if (quote.pdfDocumentId) {
      const stored = await this.docs.download(actor, quote.pdfDocumentId);
      return { filename: stored.version.filename, data: stored.data };
    }

    const renderable = await this.renderable(actor, id);
    const org = await this.settings.get();
    return {
      filename: quote.number ? `offerte-${quote.number}.pdf` : 'concept-offerte.pdf',
      data: await renderQuotePdf(renderable, org),
    };
  }

  private async renderable(actor: Actor, id: string): Promise<RenderableQuote> {
    const quote = await this.rawQuote(id);
    const client = await this.crm.getClient(actor, quote.clientId);
    const lines = await this.linesFor(id);

    return {
      number: quote.number,
      title: quote.title,
      introduction: quote.introduction,
      notes: quote.notes,
      version: quote.version,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      vatTreatment: quote.vatTreatment as VatTreatment,
      currency: quote.currency,
      subtotalCents: quote.subtotalCents,
      vatCents: quote.vatCents,
      totalCents: quote.totalCents,
      client: {
        name: client.name,
        legalName: client.legalName,
        invoiceAddress: client.invoiceAddress,
        vatNumber: client.vatNumber,
      },
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        amountCents: l.amountCents,
        unit: l.unit,
      })),
    };
  }

  // ── reading ────────────────────────────────────────────────

  async listQuotes(actor: Actor, filter: { status?: string; clientId?: string } = {}) {
    await this.require(actor, 'sales.quotes.read');
    const where = [
      filter.status ? eq(quotes.status, filter.status) : undefined,
      filter.clientId ? eq(quotes.clientId, filter.clientId) : undefined,
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(quotes)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(quotes.createdAt));

    return rows.map((row) => this.decorate(row));
  }

  async getQuote(actor: Actor, id: string) {
    await this.require(actor, 'sales.quotes.read');
    const quote = await this.rawQuote(id);
    const lines = await this.linesFor(id);
    return {
      ...this.decorate(quote),
      lines,
      vatLegend: vatLegend(quote.vatTreatment as VatTreatment),
    };
  }

  /**
   * Expiry is DERIVED, never stored: a quote should not change state while nobody is
   * looking. Same reasoning as `overdue` on invoices.
   */
  private decorate(row: typeof quotes.$inferSelect) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...row,
      expired: row.status === 'sent' && row.validUntil != null && row.validUntil < today,
      open: row.status === 'sent',
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async insertLines(
    tx: Tx,
    quoteId: string,
    lines: QuoteLineInput[],
    rate: string,
  ): Promise<void> {
    await tx.insert(quoteLines).values(
      lines.map((line, i) => {
        const totals = computeTotals([
          { quantity: line.quantity, unitPriceCents: line.unitPriceCents, vatRate: rate },
        ]);
        return {
          id: this.registry.newId(),
          quoteId,
          position: i + 1,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          amountCents: totals.subtotalCents,
          vatRate: rate,
          unit: line.unit ?? 'hours',
        };
      }),
    );
  }

  /**
   * The rate a T&M quote is priced at, taken from its hourly lines when not given
   * explicitly. Only unambiguous when every hourly line agrees — otherwise the project
   * would inherit an arbitrary one of them, so it stays null and send() asks.
   */
  private inferHourlyRate(lines: QuoteLineInput[]): number | null {
    const hourly = lines.filter((l) => (l.unit ?? 'hours') === 'hours');
    if (hourly.length === 0) return null;
    const rates = new Set(hourly.map((l) => l.unitPriceCents));
    return rates.size === 1 ? hourly[0]!.unitPriceCents : null;
  }

  /** Quotes go stale; 30 days is the usual courtesy and matches the payment terms. */
  private defaultValidUntil(): string {
    return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  }

  private async linesFor(quoteId: string) {
    return this.db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quoteId))
      .orderBy(asc(quoteLines.position));
  }

  private async rawQuote(id: string) {
    const [row] = await this.db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    if (!row) throw new NotFoundException('Quote not found');
    return row;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new BadRequestException(`Missing capability ${capability}`);
    }
  }

  /**
   * Reporting views (Phase 6a reads these, not the tables).
   *
   * DROP then CREATE rather than CREATE OR REPLACE — see TimeService for the boot
   * failure that taught us this.
   */
  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS sales.v_quotes CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW sales.v_quotes AS
      SELECT q.id, q.number, q.status, q.client_id, q.project_created_id,
             q.title, q.version, q.issue_date, q.valid_until,
             q.subtotal_cents, q.vat_cents, q.total_cents,
             q.hourly_rate_cents, q.billing_model,
             (q.status = 'sent' AND q.valid_until < CURRENT_DATE) AS expired,
             q.sent_at, q.decided_at, q.created_at
        FROM sales.quotes q
    `);
  }
}
