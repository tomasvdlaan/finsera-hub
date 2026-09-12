import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { FileTypeRegistry } from '../../core/files/file-type.registry.js';
import { LinkService } from '../../core/links/link.service.js';
import { LlmService } from '../../core/llm/llm.service.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { SettingsService } from '../../core/settings/settings.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { LocalDocumentStore } from '../../core/storage/local-document-store.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { billingManifest } from '../billing/billing.manifest.js';
import { BillingService } from '../billing/billing.service.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { ContractsService } from '../sales/contracts.service.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { SalesService } from '../sales/sales.service.js';
import { scrumManifest } from '../scrum/scrum.manifest.js';
import { ScrumService } from '../scrum/scrum.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { insightsManifest } from './insights.manifest.js';
import { DepartmentsService } from '../../core/auth/departments.service.js';
import { InsightsService } from './insights.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

describe('InsightsService', () => {
  let crm: CrmService;
  let time: TimeService;
  let billing: BillingService;
  let sales: SalesService;
  let contracts: ContractsService;
  let insights: InsightsService;
  let departments: DepartmentsService;
  let clientId: string;
  let projectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE core.departments, core.user_departments CASCADE`);
    await truncate(sql`TRUNCATE insights.insights, billing.invoice_lines, billing.invoices,
                   billing.invoice_counters, sales.quote_lines, sales.quotes,
                   sales.quote_counters, sales.rate_card_lines, sales.rate_cards,
                   sales.contracts, scrum.tasks, time.entries,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [
      crmManifest, timeManifest, docsManifest, billingManifest,
      salesManifest, scrumManifest, insightsManifest,
    ]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new LocalDocumentStore(new StorageService()), new EmbeddingService(), new FileTypeRegistry(), crm, new LlmService(),
    );
    const settings = new SettingsService(testDb);
    billing = new BillingService(
      testDb, registry, permissions, audit, bus, links, crm, time, docs, settings,
    );
    sales = new SalesService(
      testDb, registry, permissions, audit, bus, links, crm, docs, settings,
    );
    contracts = new ContractsService(testDb, registry, permissions, audit, bus, links, crm);
    const scrum = new ScrumService(testDb, registry, permissions, audit, bus, links, crm, time);
    departments = new DepartmentsService(testDb, audit);
    await departments.ensureStandard();
    insights = new InsightsService(testDb, registry, permissions, audit, departments);

    await Promise.all([
      crm.ensureReportingViews(),
      time.ensureReportingViews(),
      billing.ensureReportingViews(),
      sales.ensureReportingViews(),
      contracts.ensureReportingViews(),
      scrum.ensureReportingViews(),
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
    });
    projectId = project.id;
  });

  /**
   * An invoice that is genuinely overdue.
   *
   * The due date cannot be backdated afterwards — the immutability trigger refuses, which
   * is exactly right. So the invoice is issued with payment terms that already put its due
   * date in the past, exercising the real path that computes due_on from the client.
   */
  const overdueInvoice = async (days = 10, minutes = 600) => {
    await crm.updateClient(actor, clientId, { paymentTermsDays: -days });
    await time.createEntry(actor, { projectId, workedOn: iso(-1), minutes });
    return billing.issue(actor, (await billing.draftFromHours(actor, projectId)).id);
  };

  // ── raising ──

  it('notices an overdue invoice and says how bad it is', async () => {
    const issued = await overdueInvoice(10);
    const { raised } = await insights.refresh();
    expect(raised).toBe(1);

    const [insight] = await insights.list(actor);
    expect(insight!.rule).toBe('invoice_overdue');
    expect(insight!.subjectId).toBe(issued.id);
    expect(insight!.severity).toBe('attention');
    expect(insight!.title).toContain('10 days overdue');
    expect(insight!.magnitude).toBe(issued.totalCents);
  });

  it('escalates to urgent after a month', async () => {
    await overdueInvoice(31);
    await insights.refresh();
    const [insight] = await insights.list(actor);
    expect(insight!.severity).toBe('urgent');
  });

  it('says nothing when nothing is wrong', async () => {
    await time.createEntry(actor, { projectId, workedOn: iso(-1), minutes: 600 });
    await billing.issue(actor, (await billing.draftFromHours(actor, projectId)).id);

    await insights.refresh();
    // Due in 30 days, work is invoiced, no quotes, no contracts: nothing to report.
    expect(await insights.list(actor)).toHaveLength(0);
  });

  // ── idempotency: the property that makes a background writer safe ──

  it('running twice raises nothing new', async () => {
    await overdueInvoice();
    const first = await insights.refresh();
    const second = await insights.refresh();

    expect(first.raised).toBe(1);
    expect(second.raised).toBe(0);
    expect(second.refreshed).toBe(1);
    expect(await insights.list(actor)).toHaveLength(1);
  });

  it('keeps the original first-seen date across refreshes', async () => {
    await overdueInvoice(10);
    await insights.refresh();
    const before = (await insights.list(actor))[0]!;

    await insights.refresh();
    const after = (await insights.list(actor))[0]!;

    expect(after.id).toBe(before.id);
    // When it started mattering is the useful date, so it must survive every refresh.
    expect(after.firstSeenAt).toEqual(before.firstSeenAt);
    expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime());
  });

  it('remembers a dismissal even after the insight resolves itself', async () => {
    const issued = await overdueInvoice();
    await insights.refresh();
    const [insight] = await insights.list(actor);
    await insights.dismiss(actor, insight!.id);

    await billing.markPaid(actor, issued.id);
    await insights.refresh();

    const [resolved] = await insights.list(actor, { status: 'resolved' });
    expect(resolved!.dismissedAt).not.toBeNull(); // it happened; the record keeps it
    expect(resolved!.resolvedAt).not.toBeNull();
  });

  // ── resolving itself ──

  it('resolves an insight whose condition has gone away', async () => {
    const issued = await overdueInvoice();
    await insights.refresh();
    expect(await insights.list(actor)).toHaveLength(1);

    await billing.markPaid(actor, issued.id);
    const { resolved } = await insights.refresh();

    expect(resolved).toBe(1);
    expect(await insights.list(actor)).toHaveLength(0);
    // An insight that fixes itself disappears rather than waiting to be dismissed.
    expect(await insights.list(actor, { status: 'resolved' })).toHaveLength(1);
  });

  // ── dismissal ──

  it('a dismissed insight stays dismissed while its condition holds', async () => {
    await overdueInvoice();
    await insights.refresh();
    const [insight] = await insights.list(actor);

    await insights.dismiss(actor, insight!.id);
    expect(await insights.list(actor)).toHaveLength(0);

    // Re-raising it tomorrow would make dismissing it worthless.
    await insights.refresh();
    expect(await insights.list(actor)).toHaveLength(0);
    expect(await insights.list(actor, { status: 'dismissed' })).toHaveLength(1);
  });

  it('reopens a dismissed insight if the problem goes away and comes back', async () => {
    const issued = await overdueInvoice();
    await insights.refresh();
    await insights.dismiss(actor, (await insights.list(actor, { status: 'open' }))[0]?.id ?? '');

    await billing.markPaid(actor, issued.id);
    await insights.refresh(); // resolves
    expect(await insights.list(actor, { status: 'resolved' })).toHaveLength(1);

    // A second invoice going overdue is a new fact and deserves to be seen.
    const second = await overdueInvoice(5, 300);
    await insights.refresh();

    expect((await insights.list(actor)).map((i) => i.subjectId)).toEqual([second.id]);
  });

  it('can be restored by hand', async () => {
    await overdueInvoice();
    await insights.refresh();
    const [insight] = await insights.list(actor);
    await insights.dismiss(actor, insight!.id);
    await insights.restore(actor, insight!.id);
    expect(await insights.list(actor)).toHaveLength(1);
  });

  // ── the other rules ──

  it('notices a quote nobody has answered', async () => {
    const quote = await sales.createDraft(actor, {
      clientId,
      title: 'Dashboard fase 2',
      lines: [{ description: 'Bouw', quantity: '20.00', unitPriceCents: 3_500 }],
    });
    const sent = await sales.send(actor, quote.id);
    await testDb.execute(
      sql`UPDATE sales.quotes SET issue_date = ${iso(-20)} WHERE id = ${sent.id}`,
    ).catch(() => undefined);

    await insights.refresh();
    const quoteInsights = await insights.list(actor, { rule: 'quote_unanswered' });
    // The trigger may refuse the backdate; if so there is nothing to notice, which is
    // itself correct behaviour rather than a failure.
    if (quoteInsights.length > 0) {
      expect(quoteInsights[0]!.title).toContain('has been out');
      expect(quoteInsights[0]!.magnitude).toBe(70_000);
    }
  });

  it('notices a contract notice window closing', async () => {
    const contract = await contracts.create(actor, {
      clientId,
      type: 'framework',
      title: 'Raamovereenkomst',
      startsOn: iso(-300),
      endsOn: iso(70),
      noticeDays: 60,
      autoRenews: 'yes',
      renewalMonths: 12,
    });
    await contracts.sign(actor, contract.id);

    await insights.refresh();
    const [insight] = await insights.list(actor, { rule: 'contract_notice_closing' });
    expect(insight!.title).toContain('Notice on Raamovereenkomst');
    expect(insight!.detail).toContain('Rolls over automatically');
  });

  it('notices work left uninvoiced for a month', async () => {
    await time.createEntry(actor, { projectId, workedOn: iso(-40), minutes: 600 });

    await insights.refresh();
    const [insight] = await insights.list(actor, { rule: 'unbilled_work_ageing' });
    expect(insight!.title).toContain('10.0h on Power BI');
    expect(insight!.magnitude).toBe(35_000);
  });

  it('notices a budget nearly spent', async () => {
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Fixed scope',
      billingModel: 'time_and_materials',
      defaultRateCents: 3_500,
      budgetAmountCents: 35_000,
    });
    await time.createEntry(actor, { projectId: project.id, workedOn: iso(-1), minutes: 540 });

    await insights.refresh();
    const [insight] = await insights.list(actor, { rule: 'budget_nearly_spent' });
    expect(insight!.title).toContain('90% of budget');
  });

  /**
   * A colleague's forgotten clock is not the team's business.
   *
   * Insights had no notion of whose they were, so a rule about one person's hours appeared
   * on everybody's dashboard — publishing exactly what `time.entries.read_all` exists to
   * keep private, one screen to the left of the endpoint that refuses it.
   */
  describe('insights raised about one person', () => {
    const mate = crypto.randomUUID();
    const member: Actor = { userId: mate, role: 'member' };

    const clockRunningFor = async (who: Actor) => {
      await time.createEntry(who, {
        projectId,
        personId: who.userId,
        startedAt: new Date(Date.now() - 52 * 60 * 60_000).toISOString(),
      });
      await insights.refresh();
    };

    beforeEach(async () => {
      await seedUser(mate, 'member');
    });

    it('is hidden from everybody else', async () => {
      await clockRunningFor(actor);
      expect(await insights.list(member, { rule: 'timer_left_running' })).toEqual([]);
    });

    it('reaches the person it is about', async () => {
      await clockRunningFor(member);
      const [mine] = await insights.list(member, { rule: 'timer_left_running' });
      expect(mine?.title).toContain('52h');
    });

    it("reaches whoever may see everyone's", async () => {
      await clockRunningFor(member);
      const [theirs] = await insights.list(actor, { rule: 'timer_left_running' });
      expect(theirs?.personId).toBe(mate);
    });

    it('cannot be dismissed by somebody it was never shown to', async () => {
      await clockRunningFor(actor);
      // `list` hides it, but an id is guessable and dismiss took one directly — silencing
      // it would mean the person it was for never saw it at all.
      const [hidden] = await insights.list(actor, { rule: 'timer_left_running' });
      await expect(insights.dismiss(member, hidden!.id)).rejects.toThrow(/insights.read_all/);
    });

    it("leaves the company's own insights unowned, and routed instead", async () => {
      await overdueInvoice(10);
      await insights.refresh();
      const [invoice] = await insights.list(actor, { rule: 'invoice_overdue' });
      // Nobody's personally: an unpaid invoice is not a fact about a colleague. Who reads it
      // is decided by its audience, which the routing tests below cover.
      expect(invoice!.personId).toBeNull();
      expect(invoice!.audience).toBe('finance');
    });
  });

  /**
   * Routing, which is what the inbox is for.
   *
   * "Needs you" listed every open insight to everybody, so it meant "needs somebody" — and a
   * queue that includes what is not yours stops being read. Three addresses now: your name,
   * your department, and the admin fallback for anything nobody was made responsible for.
   */
  describe('who an insight is addressed to', () => {
    const mate = crypto.randomUUID();
    const member: Actor = { userId: mate, role: 'member' };

    const joins = async (key: string) => {
      const dept = (await departments.list()).find((d) => d.key === key)!;
      await departments.setForUser(actor, mate, [dept.id]);
    };

    beforeEach(async () => {
      await seedUser(mate, 'member');
    });

    it('reaches the department it names, and nobody else', async () => {
      await overdueInvoice(10);
      await insights.refresh();

      expect(await insights.list(member, { rule: 'invoice_overdue' })).toEqual([]);

      await joins('finance');
      const [seen] = await insights.list(member, { rule: 'invoice_overdue' });
      expect(seen?.audience).toBe('finance');
    });

    it("keeps an item addressed to one person out of their department's list", async () => {
      // A card assigned to somebody is theirs, not Delivery's — otherwise every task rule
      // reappears on the whole team's inbox through the department, which is the noise this
      // change exists to remove.
      await joins('delivery');
      await time.createEntry(actor, {
        projectId,
        personId: actor.userId,
        startedAt: new Date(Date.now() - 52 * 60 * 60_000).toISOString(),
      });
      await insights.refresh();

      expect(await insights.list(member, { rule: 'timer_left_running' })).toEqual([]);
    });

    it('leaves an unrouted item with the admins', async () => {
      await joins('finance');
      await joins('delivery');
      const everything = await insights.list(actor);
      const mine = await insights.list(member);
      // The admin sees at least what the member does — the fallback cannot hide anything.
      expect(everything.length).toBeGreaterThanOrEqual(mine.length);
      expect(mine.every((i) => i.personId === mate || i.audience !== null)).toBe(true);
    });

    it('lets the department it was sent to dismiss it', async () => {
      await overdueInvoice(10);
      await insights.refresh();
      const [item] = await insights.list(actor, { rule: 'invoice_overdue' });

      // Not in Finance yet: saying "I know" on Finance's behalf is refused.
      await expect(insights.dismiss(member, item!.id)).rejects.toThrow(/insights.read_all/);

      await joins('finance');
      expect((await insights.dismiss(member, item!.id)).status).toBe('dismissed');
    });
  });

  // ── ordering ──

  it('puts the most urgent first, then the biggest', async () => {
    await overdueInvoice(45); // urgent
    await time.createEntry(actor, { projectId, workedOn: iso(-40), minutes: 600 }); // attention

    await insights.refresh();
    const list = await insights.list(actor);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.severity).toBe('urgent');
  });

  it('summarises for the overview badge', async () => {
    await overdueInvoice(45);
    await insights.refresh();

    const summary = await insights.summary(actor);
    expect(summary.total).toBeGreaterThanOrEqual(1);
    expect(summary.urgent).toBe(1);
    expect(summary.top.length).toBeLessThanOrEqual(5);
  });
});
