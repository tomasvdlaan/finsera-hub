import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, asc, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { users } from '../../core/db/core.schema.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import {
  BILLING_MODELS,
  CLIENT_STATUSES,
  PROJECT_STATUSES,
  VAT_TREATMENTS,
  clients,
  contacts,
  projects,
} from './crm.schema.js';

type ClientStatus = (typeof CLIENT_STATUSES)[number];
type ProjectStatus = (typeof PROJECT_STATUSES)[number];
type BillingModel = (typeof BILLING_MODELS)[number];

export interface CreateClientInput {
  name: string;
  status?: ClientStatus;
  ownerId?: string | null;
  website?: string | null;
  notes?: string | null;
  // Billing (Phase 5): what an invoice legally needs about the client.
  legalName?: string | null;
  invoiceAddress?: string | null;
  kvkNumber?: string | null;
  vatNumber?: string | null;
  countryCode?: string;
  vatTreatment?: (typeof VAT_TREATMENTS)[number];
  paymentTermsDays?: number;
  invoiceEmail?: string | null;
}

export interface CreateProjectInput {
  clientId: string;
  name: string;
  status?: ProjectStatus;
  ownerId?: string | null;
  billingModel: BillingModel;
  defaultRateCents?: number | null;
  budgetAmountCents?: number | null;
  budgetHours?: number | null;
  retainerAmountCents?: number | null;
  retainerPeriod?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}

export interface CreateContactInput {
  clientId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isPrimary?: boolean;
}

type Origin = { aiInitiated?: boolean; conversationId?: string };

/**
 * The CRM module's internal API. Other modules call these methods — never this schema.
 *
 * Every write follows the pattern the walking skeleton established: mint the id, then
 * register + insert + audit + publish in ONE transaction.
 */
@Injectable()
export class CrmService {
  // Modules use select().from() rather than db.query.*: the relational API is typed on
  // the schemas registered in the core drizzle client, and the core must never import a
  // module's schema (boundary rule, Master §15.2).
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
  ) {}

  // ── clients ────────────────────────────────────────────────

  async createClient(actor: Actor, input: CreateClientInput, origin: Origin = {}) {
    await this.require(actor, 'crm.clients.write');
    const name = this.requireName(input.name);
    const ownerId = await this.resolveOwner(input.ownerId ?? actor.userId);
    const status = input.status ?? 'lead';

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'client',
        displayName: name,
        urlPath: `/clients/${id}`,
      });
      await tx.insert(clients).values({
        id,
        name,
        status,
        ownerId,
        website: input.website ?? null,
        notes: input.notes ?? null,
        legalName: input.legalName ?? null,
        invoiceAddress: input.invoiceAddress ?? null,
        kvkNumber: input.kvkNumber ?? null,
        vatNumber: input.vatNumber ?? null,
        countryCode: input.countryCode ?? 'NL',
        vatTreatment: this.validVatTreatment(input.vatTreatment, input.vatNumber),
        paymentTermsDays: input.paymentTermsDays ?? 30,
        invoiceEmail: input.invoiceEmail ?? null,
      });
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'client.create',
        entityType: 'client',
        entityId: id,
        detail: { name, status },
        aiInitiated: origin.aiInitiated ?? false,
        conversationId: origin.conversationId,
      });
      await this.events.publish(tx, {
        name: 'client.created',
        entityType: 'client',
        entityId: id,
        actorId: actor.userId,
        payload: { status },
      });
    });

    return this.getClient(actor, id);
  }

  async listClients(
    actor: Actor,
    filter: { query?: string; status?: ClientStatus; limit?: number } = {},
  ) {
    await this.require(actor, 'crm.clients.read');
    const where = [isNull(clients.archivedAt)];
    if (filter.status) where.push(eq(clients.status, filter.status));
    if (filter.query) where.push(ilike(clients.name, `%${filter.query}%`));

    return this.db
      .select()
      .from(clients)
      .where(and(...where))
      .orderBy(asc(clients.name))
      .limit(filter.limit ?? 100);
  }

  async getClient(actor: Actor, id: string) {
    await this.require(actor, 'crm.clients.read');
    const [row] = await this.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    if (!row) throw new NotFoundException('Client not found');
    return row;
  }

  /** The 360° view: client, its contacts, and its projects — one call before a meeting. */
  async getClientOverview(actor: Actor, clientId: string) {
    const client = await this.getClient(actor, clientId);
    const [clientContacts, clientProjects] = await Promise.all([
      this.listContacts(actor, clientId),
      this.listProjects(actor, { clientId }),
    ]);
    return { client, contacts: clientContacts, projects: clientProjects };
  }

  async updateClient(
    actor: Actor,
    id: string,
    patch: Partial<CreateClientInput>,
    origin: Origin = {},
  ) {
    await this.require(actor, 'crm.clients.write');
    const before = await this.getClient(actor, id);
    const name = patch.name !== undefined ? this.requireName(patch.name) : before.name;
    const status = patch.status ?? (before.status as ClientStatus);
    if (patch.status && !CLIENT_STATUSES.includes(patch.status)) {
      throw new BadRequestException(`Unknown client status '${patch.status}'`);
    }
    const ownerId =
      patch.ownerId === undefined ? before.ownerId : await this.resolveOwner(patch.ownerId);

    await this.db.transaction(async (tx) => {
      const vatNumber = patch.vatNumber === undefined ? before.vatNumber : patch.vatNumber;
      await tx
        .update(clients)
        .set({
          name,
          status,
          ownerId,
          website: patch.website === undefined ? before.website : patch.website,
          notes: patch.notes === undefined ? before.notes : patch.notes,
          legalName: patch.legalName === undefined ? before.legalName : patch.legalName,
          invoiceAddress:
            patch.invoiceAddress === undefined ? before.invoiceAddress : patch.invoiceAddress,
          kvkNumber: patch.kvkNumber === undefined ? before.kvkNumber : patch.kvkNumber,
          vatNumber,
          countryCode: patch.countryCode ?? before.countryCode,
          vatTreatment: patch.vatTreatment
            ? this.validVatTreatment(patch.vatTreatment, vatNumber)
            : before.vatTreatment,
          paymentTermsDays: patch.paymentTermsDays ?? before.paymentTermsDays,
          invoiceEmail:
            patch.invoiceEmail === undefined ? before.invoiceEmail : patch.invoiceEmail,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, id));

      // The registry's denormalized display name must not drift from the module's row.
      if (name !== before.name) {
        await this.registry.updateDisplay(tx, id, { displayName: name });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'client.update',
        entityType: 'client',
        entityId: id,
        detail: { before: { name: before.name, status: before.status }, after: { name, status } },
        aiInitiated: origin.aiInitiated ?? false,
        conversationId: origin.conversationId,
      });

      if (status !== before.status) {
        await this.events.publish(tx, {
          name: 'client.status_changed',
          entityType: 'client',
          entityId: id,
          actorId: actor.userId,
          payload: { from: before.status, to: status },
        });
      }
    });

    return this.getClient(actor, id);
  }

  async archiveClient(actor: Actor, id: string) {
    await this.require(actor, 'crm.clients.write');
    await this.getClient(actor, id);
    await this.db.transaction(async (tx) => {
      await tx.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'client.archive',
        entityType: 'client',
        entityId: id,
      });
    });
  }

  // ── contacts ───────────────────────────────────────────────

  async createContact(actor: Actor, input: CreateContactInput, origin: Origin = {}) {
    await this.require(actor, 'crm.clients.write');
    const name = this.requireName(input.name);
    await this.getClient(actor, input.clientId); // structural ref must exist

    const id = this.registry.newId();
    await this.db.transaction(async (tx) => {
      if (input.isPrimary) await this.demoteExistingPrimary(tx, input.clientId);

      await this.registry.register(tx, {
        id,
        entityType: 'contact',
        displayName: name,
        /*
         * Where a contact is actually read: on its client's page.
         *
         * This was `/crm/contacts/${id}`, an address no page has ever served. `urlPath` is
         * not documentation — it is written into `core.entities` per row and the timeline,
         * the link picker, search and every assistant citation navigate straight to it. So a
         * contact was findable, mentionable, and landed on "not found" when clicked.
         */
        urlPath: `/clients/${input.clientId}`,
      });
      await tx.insert(contacts).values({
        id,
        clientId: input.clientId,
        name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        role: input.role ?? null,
        isPrimary: input.isPrimary ?? false,
      });
      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.clientId,
        kind: 'belongs_to',
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contact.create',
        entityType: 'contact',
        entityId: id,
        detail: { name, clientId: input.clientId },
        aiInitiated: origin.aiInitiated ?? false,
        conversationId: origin.conversationId,
      });
    });

    const [row] = await this.db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    return row!;
  }

  async listContacts(actor: Actor, clientId: string) {
    await this.require(actor, 'crm.clients.read');
    return this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.clientId, clientId), isNull(contacts.archivedAt)))
      .orderBy(desc(contacts.isPrimary), asc(contacts.name));
  }

  async archiveContact(actor: Actor, id: string) {
    await this.require(actor, 'crm.clients.write');
    const [row] = await this.db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    if (!row) throw new NotFoundException('Contact not found');
    await this.db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({ archivedAt: new Date(), isPrimary: false })
        .where(eq(contacts.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'contact.archive',
        entityType: 'contact',
        entityId: id,
      });
    });
  }

  // ── projects ───────────────────────────────────────────────

  async createProject(actor: Actor, input: CreateProjectInput, origin: Origin = {}) {
    await this.require(actor, 'crm.projects.write');
    const name = this.requireName(input.name);
    await this.getClient(actor, input.clientId);
    this.validateBilling(input);

    const ownerId = await this.resolveOwner(input.ownerId ?? actor.userId);
    const status = input.status ?? 'prospective';
    const id = this.registry.newId();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id,
        entityType: 'project',
        displayName: name,
        urlPath: `/projects/${id}`,
      });
      await tx.insert(projects).values({
        id,
        clientId: input.clientId,
        name,
        status,
        ownerId,
        billingModel: input.billingModel,
        defaultRateCents: input.defaultRateCents ?? null,
        budgetAmountCents: input.budgetAmountCents ?? null,
        budgetHours: input.budgetHours != null ? String(input.budgetHours) : null,
        retainerAmountCents: input.retainerAmountCents ?? null,
        retainerPeriod: input.retainerPeriod ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
      });
      // Mirror the structural ref as a contextual link so the client's timeline and
      // 360° view pick this project up (Master §8.3).
      await this.links.createWithin(tx, actor, {
        fromId: id,
        toId: input.clientId,
        kind: 'belongs_to',
      });

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'project.create',
        entityType: 'project',
        entityId: id,
        detail: { name, clientId: input.clientId, billingModel: input.billingModel },
        aiInitiated: origin.aiInitiated ?? false,
        conversationId: origin.conversationId,
      });
      await this.events.publish(tx, {
        name: 'project.created',
        entityType: 'project',
        entityId: id,
        actorId: actor.userId,
        payload: { clientId: input.clientId, billingModel: input.billingModel },
      });
    });

    return this.getProject(actor, id);
  }

  async listProjects(
    actor: Actor,
    filter: { clientId?: string; status?: string; limit?: number } = {},
  ) {
    await this.require(actor, 'crm.projects.read');
    const where = [isNull(projects.archivedAt)];
    if (filter.clientId) where.push(eq(projects.clientId, filter.clientId));
    if (filter.status) where.push(eq(projects.status, filter.status));

    return this.db
      .select()
      .from(projects)
      .where(and(...where))
      .orderBy(asc(projects.name))
      .limit(filter.limit ?? 100);
  }

  async getProject(actor: Actor, id: string) {
    await this.require(actor, 'crm.projects.read');
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  async updateProject(actor: Actor, id: string, patch: Partial<CreateProjectInput>) {
    await this.require(actor, 'crm.projects.write');
    const before = await this.getProject(actor, id);
    const name = patch.name !== undefined ? this.requireName(patch.name) : before.name;
    const status = (patch.status ?? before.status) as ProjectStatus;
    if (patch.status && !PROJECT_STATUSES.includes(patch.status)) {
      throw new BadRequestException(`Unknown project status '${patch.status}'`);
    }

    const merged = {
      billingModel: (patch.billingModel ?? before.billingModel) as BillingModel,
      budgetAmountCents: patch.budgetAmountCents ?? before.budgetAmountCents,
      retainerAmountCents: patch.retainerAmountCents ?? before.retainerAmountCents,
      retainerPeriod: patch.retainerPeriod ?? before.retainerPeriod,
    };
    this.validateBilling(merged);

    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          name,
          status,
          billingModel: merged.billingModel,
          defaultRateCents: patch.defaultRateCents ?? before.defaultRateCents,
          budgetAmountCents: merged.budgetAmountCents,
          budgetHours:
            patch.budgetHours != null ? String(patch.budgetHours) : before.budgetHours,
          retainerAmountCents: merged.retainerAmountCents,
          retainerPeriod: merged.retainerPeriod,
          startsOn: patch.startsOn === undefined ? before.startsOn : patch.startsOn,
          endsOn: patch.endsOn === undefined ? before.endsOn : patch.endsOn,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id));

      if (name !== before.name) {
        await this.registry.updateDisplay(tx, id, { displayName: name });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'project.update',
        entityType: 'project',
        entityId: id,
        detail: { before: { name: before.name, status: before.status }, after: { name, status } },
      });

      if (status !== before.status) {
        await this.events.publish(tx, {
          name: 'project.status_changed',
          entityType: 'project',
          entityId: id,
          actorId: actor.userId,
          payload: { from: before.status, to: status },
        });
      }
    });

    return this.getProject(actor, id);
  }

  // ── AI tool handlers (thin wrappers, flagged as AI-initiated) ──

  async searchClients(actor: Actor, input: { query?: string; status?: ClientStatus; limit?: number }) {
    const rows = await this.listClients(actor, input);
    return { clients: rows.map((c) => ({ id: c.id, name: c.name, status: c.status })) };
  }

  async createLead(actor: Actor, input: { name: string; website?: string; notes?: string }) {
    const client = await this.createClient(
      actor,
      { ...input, status: 'lead' },
      { aiInitiated: true },
    );
    return { id: client.id, name: client.name };
  }

  async createProjectViaAi(actor: Actor, input: CreateProjectInput) {
    const project = await this.createProject(actor, input, { aiInitiated: true });
    return { id: project.id, name: project.name };
  }

  // ── internals ──────────────────────────────────────────────

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  /** Reverse charge without a VAT number is an invalid invoice waiting to happen. */
  private validVatTreatment(
    treatment: (typeof VAT_TREATMENTS)[number] | undefined,
    vatNumber: string | null | undefined,
  ): (typeof VAT_TREATMENTS)[number] {
    const value = treatment ?? 'domestic_21';
    if (!VAT_TREATMENTS.includes(value)) {
      throw new BadRequestException(`Unknown VAT treatment '${value}'`);
    }
    if (value === 'reverse_charge' && !vatNumber) {
      throw new BadRequestException('Reverse charge requires the client’s VAT number');
    }
    return value;
  }

  private requireName(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    return trimmed;
  }

  /**
   * owner_id has no cross-schema FK (modules stay droppable), so the reference is
   * validated here instead — otherwise a typo'd id would sit in the table unnoticed.
   */
  private async resolveOwner(ownerId: string | null | undefined): Promise<string | null> {
    if (!ownerId) return null;
    const user = await this.db.query.users.findFirst({ where: eq(users.id, ownerId) });
    if (!user) throw new BadRequestException('Owner must be an existing user');
    return user.id;
  }

  /**
   * Mirrors the database CHECK constraints so the caller gets a useful message rather
   * than a raw constraint violation. The constraints remain the real guarantee.
   */
  private validateBilling(input: {
    billingModel: BillingModel;
    budgetAmountCents?: number | null;
    retainerAmountCents?: number | null;
    retainerPeriod?: string | null;
  }): void {
    if (!BILLING_MODELS.includes(input.billingModel)) {
      throw new BadRequestException(`Unknown billing model '${input.billingModel}'`);
    }
    if (input.billingModel === 'fixed_fee' && input.budgetAmountCents == null) {
      throw new BadRequestException('A fixed-fee project needs an agreed amount');
    }
    if (
      input.billingModel === 'retainer' &&
      (input.retainerAmountCents == null || !input.retainerPeriod)
    ) {
      throw new BadRequestException('A retainer needs an amount and a period');
    }
  }

  private async demoteExistingPrimary(tx: Tx, clientId: string): Promise<void> {
    await tx
      .update(contacts)
      .set({ isPrimary: false })
      .where(and(eq(contacts.clientId, clientId), eq(contacts.isPrimary, true)));
  }

  /**
   * Published reporting views (manifest contract), rebuilt at bootstrap.
   *
   * DROP then CREATE: CREATE OR REPLACE cannot change a view's column names or order,
   * so adding a column mid-list would fail at boot.
   */
  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS crm.v_clients CASCADE`);
    await this.db.execute(sql`DROP VIEW IF EXISTS crm.v_projects CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW crm.v_clients AS
      SELECT c.id, c.name, c.status, c.owner_id, c.created_at,
             (SELECT count(*) FROM crm.projects p
               WHERE p.client_id = c.id AND p.archived_at IS NULL) AS project_count
        FROM crm.clients c
       WHERE c.archived_at IS NULL
    `);
    await this.db.execute(sql`
      CREATE VIEW crm.v_projects AS
      SELECT p.id, p.name, p.status, p.client_id, c.name AS client_name,
             p.billing_model, p.currency, p.default_rate_cents, p.budget_amount_cents,
             p.budget_hours, p.retainer_amount_cents, p.retainer_period,
             p.starts_on, p.ends_on, p.owner_id, p.created_at
        FROM crm.projects p
        JOIN crm.clients c ON c.id = p.client_id
       WHERE p.archived_at IS NULL
    `);
  }
}
