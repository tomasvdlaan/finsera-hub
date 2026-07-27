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
import { BillingService } from '../billing/billing.service.js';
import { billingManifest } from '../billing/billing.manifest.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { ContractsService } from '../sales/contracts.service.js';
import { SalesService } from '../sales/sales.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { reportingManifest } from './reporting.manifest.js';
import { ReportingService, currentMonth, currentYear } from './reporting.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const TODAY = new Date().toISOString().slice(0, 10);

describe('ReportingService', () => {
  let crm: CrmService;
  let time: TimeService;
  let billing: BillingService;
  let sales: SalesService;
  let reporting: ReportingService;
  let clientId: string;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await testDb.execute(
      sql`TRUNCATE billing.invoice_lines, billing.invoices, billing.invoice_counters,
                   sales.quote_lines, sales.quotes, sales.quote_counters,
                   sales.rate_card_lines, sales.rate_cards, sales.contracts,
                   time.entries, crm.projects, crm.contacts, crm.clients CASCADE`,
    );
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, docsManifest, billingManifest, salesManifest, reportingManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const docs = new DocsService(
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
    reporting = new ReportingService(testDb, permissions);

    // Reporting reads the v_* views, which modules create at boot. Unit tests construct
    // services directly, so the views have to be created explicitly — the dependency is
    // real either way, and this makes it visible.
    const contracts = new ContractsService(
      testDb, registry, permissions, audit, bus, links, crm,
    );
    await Promise.all([
      crm.ensureReportingViews(),
      time.ensureReportingViews(),
      billing.ensureReportingViews(),
      sales.ensureReportingViews(),
      contracts.ensureReportingViews(),
    ]);

    await settings.update({
      legalName: 'Finsera',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      iban: 'NL00BANK0123456789',
    });

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    clientId = client.id;
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
      defaultRateCents: 3_500,
      budgetAmountCents: 100_000,
    });
    projectId = project.id;
  });

  // ── the failure mode this phase is most exposed to ──

  it('reports exactly the revenue Billing reports', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    const draft = await billing.draftFromHours(actor, projectId);
    const issued = await billing.issue(actor, draft.id);

    const revenue = await reporting.revenue(actor, currentYear());

    // Two implementations disagreeing about revenue is the whole risk here.
    expect(revenue.totalExVatCents).toBe(issued.subtotalCents);
    expect(revenue.totalIncVatCents).toBe(issued.totalCents);
    expect(revenue.byClient[0]!.clientName).toBe('DocHorse');
  });

  it('counts a credit note as negative, so a credited month is not flattering', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    const issued = await billing.issue(actor, (await billing.draftFromHours(actor, projectId)).id);
    const credit = await billing.createCreditNote(actor, issued.id);
    await billing.issue(actor, credit.id);

    const revenue = await reporting.revenue(actor, currentYear());
    expect(revenue.totalExVatCents).toBe(0);
  });

  it('excludes drafts — nothing has been asked for yet', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    await billing.draftFromHours(actor, projectId);

    expect((await reporting.revenue(actor, currentYear())).totalExVatCents).toBe(0);
  });

  // ── periods ──

  it('treats the period end as exclusive, so months cannot double-count', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    await billing.issue(actor, (await billing.draftFromHours(actor, projectId)).id);

    const month = currentMonth();
    const inside = await reporting.revenue(actor, month);
    expect(inside.totalExVatCents).toBe(35_000);

    // A period ending the day the invoice was issued must exclude it.
    const upToToday = await reporting.revenue(actor, { from: month.from, to: TODAY });
    expect(upToToday.totalExVatCents).toBe(0);
  });

  it('returns zeros for an empty period rather than nulls', async () => {
    const revenue = await reporting.revenue(actor, { from: '2020-01-01', to: '2020-02-01' });
    expect(revenue.totalExVatCents).toBe(0);
    expect(revenue.byMonth).toEqual([]);

    const util = await reporting.utilisation(actor, { from: '2020-01-01', to: '2020-02-01' });
    expect(util.totalMinutes).toBe(0);
    expect(util.billableRatio).toBeNull(); // no ratio exists, rather than 0%
  });

  it('rejects a reversed or malformed period', async () => {
    await expect(
      reporting.revenue(actor, { from: '2026-02-01', to: '2026-01-01' }),
    ).rejects.toThrow(/after its start/);
    await expect(
      reporting.revenue(actor, { from: 'January', to: '2026-01-01' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  // ── the number that earns its place ──

  it('values unbilled work at the project rate', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 90 });
    // Non-billable time is work, but it is not money.
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 60, billable: false });

    const unbilled = await reporting.unbilled(actor);
    expect(unbilled.totalMinutes).toBe(690);
    expect(unbilled.totalValueCents).toBe(Math.round((690 * 3_500) / 60)); // €402,50
    expect(unbilled.byProject).toHaveLength(1);
  });

  it('drops work out of unbilled once it is on an invoice', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    expect((await reporting.unbilled(actor)).totalMinutes).toBe(600);

    await billing.draftFromHours(actor, projectId);
    expect((await reporting.unbilled(actor)).totalMinutes).toBe(0);
  });

  // ── outstanding ──

  it('splits what is owed into current and overdue', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    const issued = await billing.issue(actor, (await billing.draftFromHours(actor, projectId)).id);

    const outstanding = await reporting.outstanding(actor);
    expect(outstanding.totalCents).toBe(issued.totalCents);
    expect(outstanding.overdueCents).toBe(0); // due in 30 days
    expect(outstanding.currentCount).toBe(1);

    // Paying it removes it from what is owed.
    await billing.markPaid(actor, issued.id);
    expect((await reporting.outstanding(actor)).totalCents).toBe(0);
  });

  // ── utilisation ──

  it('reports the billable share of logged time', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 360 });
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 120, billable: false });

    const util = await reporting.utilisation(actor, currentMonth());
    expect(util.totalMinutes).toBe(480);
    expect(util.billableMinutes).toBe(360);
    expect(util.billableRatio).toBe(0.75);
  });

  // ── pipeline ──

  it('reports quote pipeline and withholds a conversion rate until something is decided', async () => {
    const quote = await sales.createDraft(actor, {
      clientId,
      title: 'Dashboard fase 2',
      lines: [{ description: 'Bouw', quantity: '10.00', unitPriceCents: 3_500 }],
    });
    const sent = await sales.send(actor, quote.id);

    const open = await reporting.pipeline(actor);
    expect(open.byStatus.sent!.count).toBe(1);
    expect(open.outstandingValueCents).toBe(35_000);
    expect(open.conversionRate).toBeNull(); // nothing decided: 0% would be a lie

    await sales.accept(actor, sent.id);
    const won = await reporting.pipeline(actor);
    expect(won.wonValueCents).toBe(35_000);
    expect(won.conversionRate).toBe(1);
  });

  // ── profitability ──

  it('reports earned value against budget', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });

    const rows = await reporting.projectProfitability(actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.earnedCents).toBe(35_000);
    expect(rows[0]!.budgetUsedPct).toBe(35); // €350 of a €1000 budget
  });

  it('omits projects nobody has worked on', async () => {
    await crm.createProject(actor, {
      clientId,
      name: 'Untouched',
      billingModel: 'time_and_materials',
    });
    const rows = await reporting.projectProfitability(actor);
    expect(rows.map((r) => r.projectName)).not.toContain('Untouched');
  });

  // ── overview ──

  it('assembles the overview without a second implementation of any number', async () => {
    await time.createEntry(actor, { projectId, workedOn: TODAY, minutes: 600 });
    const overview = await reporting.overview(actor);

    expect(overview.unbilled.totalMinutes).toBe(600);
    expect(overview.utilisation.billableRatio).toBe(1);
    expect(overview.outstanding.totalCents).toBe(0);
    // Each section matches calling the metric directly — the overview only composes.
    expect(overview.revenueYear).toEqual(await reporting.revenue(actor, currentYear()));
  });
});
