import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { ContractsService } from './contracts.service.js';
import { salesManifest } from './sales.manifest.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** Dates relative to today, so these tests do not rot. */
const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

describe('ContractsService', () => {
  let crm: CrmService;
  let contracts: ContractsService;
  let registry: RegistryService;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE sales.rate_card_lines, sales.rate_cards, sales.contracts,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(docsManifest);
    manifests.register(salesManifest);
    manifests.seal();

    registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    contracts = new ContractsService(testDb, registry, permissions, audit, bus, links, crm);

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'active' });
    clientId = client.id;
  });

  const framework = (over: Record<string, unknown> = {}) =>
    contracts.create(actor, {
      clientId,
      type: 'framework',
      title: 'Raamovereenkomst DocHorse',
      startsOn: iso(-365),
      endsOn: iso(90),
      noticeDays: 60,
      autoRenews: 'yes',
      renewalMonths: 12,
      ...over,
    } as Parameters<ContractsService['create']>[1]);

  // ── the register ──

  it('records a contract with its terms', async () => {
    const contract = await framework();
    expect(contract.type).toBe('framework');
    expect(contract.status).toBe('draft');
    expect(contract.noticeDays).toBe(60);
    expect(contract.signedAt).toBeNull();
  });

  it('rejects an unknown type', async () => {
    await expect(
      framework({ type: 'handshake' as 'framework' }),
    ).rejects.toThrow(/Unknown contract type/);
  });

  it('refuses to sign without a start date', async () => {
    const contract = await framework({ startsOn: null });
    await expect(contracts.sign(actor, contract.id)).rejects.toThrow(/start date/);
  });

  it('links to its signed document without copying it', async () => {
    // A registry id is enough: Documents owns the bytes, this owns the dates. The link
    // service validates the target exists, which is why this registers a real one.
    const documentId = registry.newId();
    await testDb.transaction(async (tx) => {
      await registry.register(tx, {
        id: documentId,
        entityType: 'document',
        displayName: 'Raamovereenkomst (getekend).pdf',
        urlPath: `/docs/${documentId}`,
      });
    });

    const contract = await framework({ documentId });
    expect(contract.documentId).toBe(documentId);

    const links = await testDb.execute(
      sql`SELECT link_kind FROM core.links WHERE from_id = ${contract.id} AND to_id = ${documentId}`,
    );
    expect(links.rows).toHaveLength(1);
  });

  // ── derived dates, never stored ──

  it('derives the notice deadline and flags a closing window', async () => {
    // Ends in 90 days with 60 days' notice: the deadline is 30 days away, so notice
    // must be given soon or it rolls over for another year.
    const signed = await contracts.sign(actor, (await framework()).id);

    expect(signed.daysUntilEnd).toBe(90);
    expect(signed.noticeDeadline).toBe(iso(30));
    expect(signed.inNoticeWindow).toBe(true);
    expect(signed.noticeClosingSoon).toBe(true);
    expect(signed.expired).toBe(false);
  });

  it('does not flag a notice window that is comfortably far off', async () => {
    const signed = await contracts.sign(
      actor,
      (await framework({ endsOn: iso(300), noticeDays: 60 })).id,
    );
    expect(signed.noticeDeadline).toBe(iso(240));
    expect(signed.noticeClosingSoon).toBe(false);
    expect(signed.expiringSoon).toBe(false);
  });

  it('reports an expired contract without having changed its status', async () => {
    const signed = await contracts.sign(
      actor,
      (await framework({ startsOn: iso(-800), endsOn: iso(-10) })).id,
    );
    expect(signed.expired).toBe(true);
    expect(signed.daysUntilEnd).toBe(-10);
    // Nothing ran in the background: the stored status still says signed.
    expect(signed.status).toBe('signed');
  });

  it('leaves an open-ended contract without an end or a deadline', async () => {
    const signed = await contracts.sign(
      actor,
      (await framework({ endsOn: null, noticeDays: 90, autoRenews: 'no', renewalMonths: null })).id,
    );
    expect(signed.daysUntilEnd).toBeNull();
    expect(signed.noticeDeadline).toBeNull();
    expect(signed.expired).toBe(false);
  });

  // ── immutability ──

  it('freezes a signed contract, in the database as well as the service', async () => {
    const signed = await contracts.sign(actor, (await framework()).id);

    await expect(contracts.update(actor, signed.id, { noticeDays: 1 })).rejects.toThrow(
      /amendment/,
    );
    await expect(contracts.remove(actor, signed.id)).rejects.toThrow(/terminate it instead/);

    // Straight at the database. These dates are what a dispute turns on.
    await expect(
      testDb.execute(sql`UPDATE sales.contracts SET notice_days = 1 WHERE id = ${signed.id}`),
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.execute(sql`UPDATE sales.contracts SET ends_on = '2099-01-01' WHERE id = ${signed.id}`),
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.execute(sql`DELETE FROM sales.contracts WHERE id = ${signed.id}`),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it('still allows the lifecycle it must: terminating', async () => {
    const signed = await contracts.sign(actor, (await framework()).id);
    const ended = await contracts.terminate(actor, signed.id, 'Client moved in-house');
    expect(ended.status).toBe('terminated');
    expect(ended.terminatedAt).not.toBeNull();
  });

  it('publishes contract.signed', async () => {
    await contracts.sign(actor, (await framework()).id);
    const names = (
      await testDb.execute(sql`SELECT event_name FROM core.events`)
    ).rows.map((r) => (r as { event_name: string }).event_name);
    expect(names).toContain('contract.signed');
  });

  // ── the DPA question O8 needs answered ──

  it('records whether a DPA permits sub-processors', async () => {
    const dpa = await contracts.create(actor, {
      clientId,
      type: 'dpa',
      title: 'Verwerkersovereenkomst',
      startsOn: iso(-30),
      allowsSubProcessors: 'yes',
      notes: 'Sub-processors permitted with notification.',
    });
    expect(dpa.allowsSubProcessors).toBe('yes');

    const dpas = await contracts.list(actor, { type: 'dpa' });
    expect(dpas).toHaveLength(1);
  });

  // ── rate cards ──

  it('keeps every rate, so last year’s price still has an answer', async () => {
    const card = await contracts.createRateCard(actor, {
      clientId,
      name: 'DocHorse 2026',
      lines: [{ role: 'Consultant', rateCents: 3_500, effectiveFrom: '2025-01-01' }],
    });
    // An indexation adds a rate; it does not overwrite one.
    const indexed = await contracts.addRate(actor, card.id, {
      role: 'Consultant',
      rateCents: 3_750,
      effectiveFrom: '2026-01-01',
    });

    expect(indexed.lines).toHaveLength(2);
    expect(indexed.currentRates).toHaveLength(1);
    expect(indexed.currentRates[0]!.rateCents).toBe(3_750); // what we charge today
  });

  it('selects the rate in force on a given date', async () => {
    const card = await contracts.createRateCard(actor, {
      clientId,
      name: 'DocHorse',
      lines: [
        { role: 'Consultant', rateCents: 3_500, effectiveFrom: '2025-01-01' },
        { role: 'Consultant', rateCents: 3_750, effectiveFrom: '2026-01-01' },
        { role: 'Senior BI', rateCents: 4_500, effectiveFrom: '2025-01-01' },
      ],
    });

    expect(await contracts.rateOn(card.id, 'Consultant', '2025-06-30')).toBe(3_500);
    expect(await contracts.rateOn(card.id, 'Consultant', '2025-12-31')).toBe(3_500);
    expect(await contracts.rateOn(card.id, 'Consultant', '2026-01-01')).toBe(3_750);
    expect(await contracts.rateOn(card.id, 'Senior BI', '2026-06-01')).toBe(4_500);
    // Before any rate existed there is no answer, rather than a wrong one.
    expect(await contracts.rateOn(card.id, 'Consultant', '2024-01-01')).toBeNull();
    expect(await contracts.rateOn(card.id, 'Nobody', '2026-01-01')).toBeNull();
  });

  it('applies a rate to a project — the seam, and the only thing that moves money', async () => {
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
      defaultRateCents: 3_500,
    });
    const card = await contracts.createRateCard(actor, {
      clientId,
      name: 'DocHorse 2026',
      lines: [
        { role: 'Consultant', rateCents: 3_500, effectiveFrom: '2025-01-01' },
        { role: 'Consultant', rateCents: 3_750, effectiveFrom: '2026-01-01' },
      ],
    });

    const updated = await contracts.applyRateToProject(actor, {
      projectId: project.id,
      rateCardId: card.id,
      role: 'Consultant',
      on: '2026-06-01',
    });
    expect(updated.defaultRateCents).toBe(3_750);

    // And the project is genuinely changed, which is what invoicing will read.
    expect((await crm.getProject(actor, project.id)).defaultRateCents).toBe(3_750);
  });

  it('refuses to apply a rate that was not in force', async () => {
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
    });
    const card = await contracts.createRateCard(actor, {
      clientId,
      name: 'DocHorse',
      lines: [{ role: 'Consultant', rateCents: 3_750, effectiveFrom: '2026-01-01' }],
    });

    await expect(
      contracts.applyRateToProject(actor, {
        projectId: project.id,
        rateCardId: card.id,
        role: 'Consultant',
        on: '2025-06-01',
      }),
    ).rejects.toThrow(/No rate for 'Consultant'/);
  });

  it('does NOT change a project rate when a rate card is edited', async () => {
    // Decision D1: the project rate is authoritative, so a rate card edit can never
    // quietly change what a draft invoice bills.
    const project = await crm.createProject(actor, {
      clientId,
      name: 'Power BI',
      billingModel: 'time_and_materials',
      defaultRateCents: 3_500,
    });
    const card = await contracts.createRateCard(actor, {
      clientId,
      name: 'DocHorse',
      lines: [{ role: 'Consultant', rateCents: 3_500, effectiveFrom: '2025-01-01' }],
    });

    await contracts.addRate(actor, card.id, {
      role: 'Consultant',
      rateCents: 9_900,
      effectiveFrom: '2025-01-01',
    });

    expect((await crm.getProject(actor, project.id)).defaultRateCents).toBe(3_500);
  });

  it('offers house rates alongside a client’s own', async () => {
    await contracts.createRateCard(actor, { name: 'House rates', clientId: null });
    await contracts.createRateCard(actor, { name: 'DocHorse', clientId });

    const forClient = await contracts.listRateCards(actor, clientId);
    expect(forClient.map((c) => c.name).sort()).toEqual(['DocHorse', 'House rates']);
  });
});
