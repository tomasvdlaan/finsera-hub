import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { FileTypeRegistry } from '../../core/files/file-type.registry.js';
import { LinkService } from '../../core/links/link.service.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { SettingsService } from '../../core/settings/settings.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { resetDb, seedUser, testDb } from '../../test/db.js';
import { billingManifest } from '../billing/billing.manifest.js';
import { BillingService } from '../billing/billing.service.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { ContractsService } from '../sales/contracts.service.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { SalesService } from '../sales/sales.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { PortalProjection, type PortalVisitor } from './portal.projection.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

const allManifests = [crmManifest, timeManifest, docsManifest, billingManifest, salesManifest];

/**
 * What each manifest declares, read at import time.
 *
 * The registry hands the projection a parsed copy, so tests edit that copy and these stay
 * pristine — which is what makes the inventory below an assertion about the real
 * manifests rather than about whatever an earlier test left behind.
 */
const declaredByDefault = new Map(allManifests.map((m) => [m.name, [...m.portalExposure]]));

/**
 * Two clients, one portal visitor.
 *
 * Every test below asks the same question in a different way: can the visitor for client
 * A see anything belonging to client B? The answer has to be no every time, and these
 * tests exist to fail loudly the day it stops being.
 */
describe('PortalProjection', () => {
  let crm: CrmService;
  let billing: BillingService;
  let sales: SalesService;
  let docs: DocsService;
  let time: TimeService;
  let links: LinkService;
  let projection: PortalProjection;
  let manifests: ManifestRegistry;

  let ours: string;
  let theirs: string;
  let visitor: PortalVisitor;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(
      sql`TRUNCATE portal.users, billing.invoice_lines, billing.invoices,
                   billing.invoice_counters, sales.quote_lines, sales.quotes,
                   sales.quote_counters, docs.chunks, docs.versions, docs.documents,
                   time.entries, crm.projects, crm.contacts, crm.clients CASCADE`,
    );
    await seedUser(actor.userId, 'admin');

    manifests = new ManifestRegistry();
    for (const m of allManifests) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new StorageService(), new EmbeddingService(), new FileTypeRegistry(), crm,
    );
    const settings = new SettingsService(testDb);
    billing = new BillingService(
      testDb, registry, permissions, audit, bus, links, crm, time, docs, settings,
    );
    sales = new SalesService(
      testDb, registry, permissions, audit, bus, links, crm, docs, settings,
    );
    const contracts = new ContractsService(testDb, registry, permissions, audit, bus, links, crm);

    await Promise.all([
      crm.ensureReportingViews(),
      time.ensureReportingViews(),
      billing.ensureReportingViews(),
      sales.ensureReportingViews(),
      contracts.ensureReportingViews(),
      docs.ensureReportingViews?.(),
    ]);
    await settings.update({
      legalName: 'Finsera', kvkNumber: '12345678',
      vatNumber: 'NL123456789B01', iban: 'NL00BANK0123456789',
    });

    projection = new PortalProjection(testDb, manifests);

    ours = (await crm.createClient(actor, { name: 'Our client', status: 'active' })).id;
    theirs = (await crm.createClient(actor, { name: 'Someone else', status: 'active' })).id;
    visitor = { portalUserId: crypto.randomUUID(), clientId: ours, email: 'them@ourclient.nl' };
  });

  /**
   * Withdraw an entity type's declaration, as deleting it from a manifest would.
   *
   * On the registry's own copies, not the imported singletons: `register` stores what zod
   * parsed, so editing the singleton changes nothing the projection reads.
   */
  const unexpose = (entityType: string) => {
    for (const m of manifests.all()) {
      const at = m.portalExposure.findIndex((e) => e.entityType === entityType);
      if (at >= 0) m.portalExposure.splice(at, 1);
    }
  };

  // ── nothing is visible unless a module said so ──

  it('refuses an entity type whose declaration has been withdrawn', async () => {
    // The manifest declaration is the switch, and it has to work in both directions:
    // without this check writing a query would be enough to expose something, and taking
    // a declaration away would leave the data reachable.
    unexpose('project');
    unexpose('invoice');
    unexpose('quote');

    await expect(projection.projects(visitor)).rejects.toThrow(/Not available/);
    await expect(projection.invoices(visitor)).rejects.toThrow(/Not available/);
    await expect(projection.quotes(visitor)).rejects.toThrow(/Not available/);
  });

  it('exposes exactly this, and nothing else', () => {
    // A deliberate inventory rather than a spot check. Any field added to any manifest —
    // in any module, including one that does not exist yet — fails here until somebody
    // updates this list, which is the moment the decision gets looked at.
    const inventory = [...declaredByDefault.entries()]
      .flatMap(([module, exposure]) =>
        exposure.map((e) => `${module}.${e.entityType}: ${e.fields.join(', ')}`),
      )
      .sort();

    expect(inventory).toEqual([
      'billing.invoice: id, number, status, issue_date, due_on, subtotal_cents, vat_cents, total_cents, currency, overdue',
      'crm.project: id, name, status, starts_on, ends_on',
      'docs.document: id, title, category, created_at',
      'sales.quote: id, number, title, status, issue_date, valid_until, subtotal_cents, vat_cents, total_cents, expired',
      'sales.quote_line: description, quantity, unit, unit_price_cents, amount_cents',
    ]);
  });

  it('has nothing to say about entity types no module offered', () => {
    // Clients, hours, contracts, tasks, meetings: never declared, so never reachable.
    for (const entityType of ['client', 'time_entry', 'contract', 'task', 'meeting']) {
      expect(projection.exposedFields(entityType)).toEqual([]);
    }
  });

  it('returns no column the manifest did not declare', () => {
    // The queries and the declarations are written in different files by different hands.
    // This is what keeps them honest: a column added to a SELECT without a matching
    // declaration is a leak, and it fails here rather than in front of a client.
    const returns = {
      project: ['id', 'name', 'status', 'starts_on', 'ends_on'],
      invoice: ['id', 'number', 'status', 'issue_date', 'due_on', 'subtotal_cents',
        'vat_cents', 'total_cents', 'overdue', 'currency'],
      quote: ['id', 'number', 'title', 'status', 'issue_date', 'valid_until',
        'subtotal_cents', 'vat_cents', 'total_cents', 'expired'],
      quote_line: ['description', 'quantity', 'unit_price_cents', 'amount_cents', 'unit'],
      document: ['id', 'title', 'category', 'created_at'],
    };

    for (const [entityType, columns] of Object.entries(returns)) {
      const declared = projection.exposedFields(entityType);
      expect(columns.filter((c) => !declared.includes(c)), `${entityType} leaks`).toEqual([]);
    }
  });

  // ── the question this phase exists to answer ──

  it('never shows another client’s projects', async () => {
    await crm.createProject(actor, { clientId: ours, name: 'Ours', billingModel: 'time_and_materials' });
    await crm.createProject(actor, { clientId: theirs, name: 'Theirs', billingModel: 'time_and_materials' });

    const rows = await projection.projects(visitor);
    expect(rows.map((r) => (r as { name: string }).name)).toEqual(['Ours']);
  });

  it('never shows another client’s invoices', async () => {
    for (const clientId of [ours, theirs]) {
      const project = await crm.createProject(actor, {
        clientId, name: `P-${clientId.slice(0, 4)}`,
        billingModel: 'time_and_materials', defaultRateCents: 3_500,
      });
      await time.createEntry(actor, { projectId: project.id, workedOn: '2026-07-01', minutes: 60 });
      await billing.issue(actor, (await billing.draftFromHours(actor, project.id)).id);
    }

    const rows = await projection.invoices(visitor);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { client_id?: string }).client_id ?? ours).toBe(ours);
  });

  it('never shows another client’s quotes, or their lines', async () => {
    const theirQuote = await sales.send(
      actor,
      (
        await sales.createDraft(actor, {
          clientId: theirs,
          title: 'Not for you',
          lines: [{ description: 'Secret work', quantity: '1.00', unitPriceCents: 100_000 }],
        })
      ).id,
    );

    expect(await projection.quotes(visitor)).toHaveLength(0);
    // Knowing the id is not permission to read it — the ownership check is on the query,
    // not on which list the id came from.
    expect(await projection.quoteLines(visitor, theirQuote.id)).toHaveLength(0);
  });

  // ── what "belongs to a client" does not mean ──

  it('does not show a document merely filed against the client', async () => {
    await docs.upload(actor, {
      filename: 'internal-analysis.md',
      mimeType: 'text/markdown',
      data: Buffer.from('Our margin on this account is thin.'),
      title: 'Internal analysis',
      clientId: ours,
    });

    // Filed against a client is not the same as shown to them: this one is our own
    // analysis of their account, and it is filed under them precisely so we can find it.
    expect(await projection.documents(visitor)).toHaveLength(0);
  });

  it('shows a document only once it has been deliberately shared', async () => {
    const doc = await docs.upload(actor, {
      filename: 'report.md',
      mimeType: 'text/markdown',
      data: Buffer.from('The report they paid for.'),
      title: 'Their report',
      clientId: ours,
    });

    await testDb.transaction(async (tx) => {
      await links.createWithin(tx, actor, {
        fromId: doc.id, toId: ours, kind: 'shared_with_client',
      });
    });

    const shared = await projection.documents(visitor);
    expect(shared).toHaveLength(1);
    expect(await projection.mayReadDocument(visitor, doc.id)).toBe(true);
  });

  it('refuses bytes for a document shared with a different client', async () => {
    const doc = await docs.upload(actor, {
      filename: 'theirs.md', mimeType: 'text/markdown',
      data: Buffer.from('x'), title: 'Theirs', clientId: theirs,
    });
    await testDb.transaction(async (tx) => {
      await links.createWithin(tx, actor, {
        fromId: doc.id, toId: theirs, kind: 'shared_with_client',
      });
    });

    expect(await projection.mayReadDocument(visitor, doc.id)).toBe(false);
  });

  // ── things a client should not see about their own account ──

  it('does not return rates, budgets or margin on a project', async () => {
    await crm.createProject(actor, {
      clientId: ours, name: 'Ours', billingModel: 'time_and_materials',
      defaultRateCents: 3_500, budgetAmountCents: 100_000,
    });

    const [row] = (await projection.projects(visitor)) as Array<Record<string, unknown>>;
    // Not selected, so no later edit to this query can leak them by accident.
    expect(row).not.toHaveProperty('default_rate_cents');
    expect(row).not.toHaveProperty('budget_amount_cents');
  });

  it('does not show a draft invoice', async () => {
    const project = await crm.createProject(actor, {
      clientId: ours, name: 'Ours', billingModel: 'time_and_materials', defaultRateCents: 3_500,
    });
    await time.createEntry(actor, { projectId: project.id, workedOn: '2026-07-01', minutes: 60 });
    await billing.draftFromHours(actor, project.id);

    // An unsent invoice is not something the client is owed sight of, and watching one
    // change would be worse than not seeing it.
    expect(await projection.invoices(visitor)).toHaveLength(0);
  });

  it('does not show a draft quote', async () => {
    await sales.createDraft(actor, {
      clientId: ours, title: 'Still thinking about the price',
      lines: [{ description: 'Work', quantity: '1.00', unitPriceCents: 100_000 }],
    });
    expect(await projection.quotes(visitor)).toHaveLength(0);
  });

  // ── a visitor with no data ──

  it('returns nothing rather than everything for a client with no records', async () => {
    const stranger: PortalVisitor = {
      portalUserId: crypto.randomUUID(),
      clientId: crypto.randomUUID(), // a client id that matches nothing
      email: 'nobody@example.com',
    };

    expect(await projection.projects(stranger)).toHaveLength(0);
    expect(await projection.invoices(stranger)).toHaveLength(0);
    expect(await projection.quotes(stranger)).toHaveLength(0);
  });
});
