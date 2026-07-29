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
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { salesManifest } from './sales.manifest.js';
import { SalesService } from './sales.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

describe('SalesService', () => {
  let crm: CrmService;
  let sales: SalesService;
  let settings: SettingsService;
  let clientId: string;

  /** A typical Finsera engagement: 24 hours of Power BI work at €35. */
  const LINES = [
    { description: 'Power BI dashboard — ontwerp en bouw', quantity: '24.00', unitPriceCents: 3_500 },
  ];

  const draft = (over: Partial<Parameters<SalesService['createDraft']>[1]> = {}) =>
    sales.createDraft(actor, {
      clientId,
      title: 'Power BI dashboard',
      lines: LINES,
      ...over,
    });

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE sales.quote_lines, sales.quotes, sales.quote_counters,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(docsManifest);
    manifests.register(salesManifest);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const docs = new DocsService(
      testDb,
      registry,
      permissions,
      audit,
      bus,
      links,
      new StorageService(),
      new EmbeddingService(),
      new FileTypeRegistry(),
      crm,
    );
    settings = new SettingsService(testDb);
    sales = new SalesService(
      testDb,
      registry,
      permissions,
      audit,
      bus,
      links,
      crm,
      docs,
      settings,
    );

    // Sending requires the org's own legal details, so every send test needs them.
    await settings.update({
      legalName: 'Finsera',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      iban: 'NL00BANK0123456789',
    });

    const client = await crm.createClient(actor, { name: 'DocHorse', status: 'lead' });
    clientId = client.id;
  });

  // ── totals ──

  it('totals a quote to the cent, reusing the invoice VAT engine', async () => {
    const quote = await draft(); // 24 × €35 = €840,00 + 21% (€176,40) = €1016,40

    expect(quote.subtotalCents).toBe(84_000);
    expect(quote.vatCents).toBe(17_640);
    expect(quote.totalCents).toBe(101_640);
    expect(quote.status).toBe('draft');
    expect(quote.number).toBeNull(); // numbers are allocated on send, never at draft
  });

  it('rounds VAT per rate group on a mixed quote', async () => {
    const quote = await draft({
      lines: [
        { description: 'Consultancy', quantity: '3.00', unitPriceCents: 3_333 },
        { description: 'Workshop', quantity: '1.00', unitPriceCents: 95_000, unit: 'fixed' },
      ],
    });
    // 9999 + 95000 = 104999; 21% of that = 22049.79 → 22050 half-up, once, on the group.
    expect(quote.subtotalCents).toBe(104_999);
    expect(quote.vatCents).toBe(22_050);
    expect(quote.totalCents).toBe(127_049);
  });

  it('applies the client’s VAT treatment', async () => {
    await crm.updateClient(actor, clientId, {
      vatTreatment: 'reverse_charge',
      vatNumber: 'DE123456789',
      countryCode: 'DE',
    });
    const quote = await draft();
    expect(quote.vatCents).toBe(0);
    expect(quote.totalCents).toBe(84_000);
    expect(quote.vatLegend).toContain('BTW verlegd');
  });

  // ── drafting ──

  it('infers the hourly rate from consistent hourly lines', async () => {
    const quote = await draft();
    expect(quote.hourlyRateCents).toBe(3_500);
  });

  it('refuses to guess a rate when hourly lines disagree', async () => {
    const quote = await draft({
      lines: [
        { description: 'Senior', quantity: '10.00', unitPriceCents: 3_500 },
        { description: 'Junior', quantity: '10.00', unitPriceCents: 2_000 },
      ],
    });
    // Two rates, so no single project rate can be inferred — send() will ask.
    expect(quote.hourlyRateCents).toBeNull();
    await expect(sales.send(actor, quote.id)).rejects.toThrow(/hourly rate/);
  });

  it('lets a draft’s lines be replaced, added to and removed', async () => {
    const quote = await draft();
    const updated = await sales.updateDraftLines(actor, quote.id, [
      ...LINES,
      { description: 'Workshop', quantity: '1.00', unitPriceCents: 75_000, unit: 'fixed' },
    ]);
    expect(updated.lines).toHaveLength(2);
    expect(updated.subtotalCents).toBe(159_000);

    const trimmed = await sales.updateDraftLines(actor, quote.id, LINES);
    expect(trimmed.lines).toHaveLength(1);
    expect(trimmed.subtotalCents).toBe(84_000);
  });

  it('defaults validity to 30 days', async () => {
    const quote = await draft();
    expect(quote.validUntil).not.toBeNull();
    expect(quote.expired).toBe(false);
    expect(await sales.send(actor, quote.id).then((q) => q.expired)).toBe(false);
  });

  it('derives expiry from today rather than storing it', async () => {
    // Sent with a validity already in the past. Nothing runs in the background, so if
    // expiry were a stored status this quote would still claim to be open.
    const quote = await draft({ validUntil: '2020-01-01' });
    const sent = await sales.send(actor, quote.id);

    expect(sent.expired).toBe(true);
    expect(sent.status).toBe('sent'); // the stored status is untouched
    expect(sent.validUntil).toBe('2020-01-01');

    // And an expired quote can still be accepted — expiry is information, not a lock.
    // Whether to honour a lapsed price is a commercial decision, not a database rule.
    await expect(sales.accept(actor, sent.id)).resolves.toMatchObject({ status: 'accepted' });
  });

  it('freezes the validity date too, so a sent promise cannot be quietly extended', async () => {
    const sent = await sales.send(actor, (await draft()).id);
    await expect(
      testDb.execute(sql`UPDATE sales.quotes SET valid_until = '2030-01-01' WHERE id = ${sent.id}`),
    ).rejects.toThrow(/immutable/);
  });

  // ── sending ──

  it('allocates a number on send and files the PDF', async () => {
    const quote = await draft();
    const sent = await sales.send(actor, quote.id);

    const year = new Date().getFullYear();
    expect(sent.number).toBe(`Q${year}-0001`);
    expect(sent.status).toBe('sent');
    expect(sent.issueDate).not.toBeNull();
    expect(sent.pdfDocumentId).not.toBeNull();

    const { filename, data } = await sales.getPdf(actor, sent.id);
    expect(filename).toBe(`offerte-${sent.number}.pdf`);
    expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a draft preview without filing anything', async () => {
    const quote = await draft();
    const { filename, data } = await sales.getPdf(actor, quote.id);
    expect(filename).toBe('concept-offerte.pdf');
    expect(data.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await sales.getQuote(actor, quote.id)).pdfDocumentId).toBeNull();
  });

  it('refuses to send without the organisation’s own details', async () => {
    await settings.update({ kvkNumber: '', vatNumber: '', iban: '' });
    const quote = await draft();
    await expect(sales.send(actor, quote.id)).rejects.toThrow(/organisation details/);
  });

  it('uses a separate counter from invoices, so gaps here are harmless', async () => {
    const a = await draft();
    await sales.send(actor, a.id);

    const abandoned = await draft({ title: 'Abandoned' });
    await sales.deleteDraft(actor, abandoned.id); // never numbered, leaves nothing behind

    const b = await draft({ title: 'Second' });
    const sentB = await sales.send(actor, b.id);
    expect(sentB.number).toBe(`Q${new Date().getFullYear()}-0002`);
  });

  it('sends concurrently without colliding', async () => {
    const a = await draft({ title: 'A' });
    const b = await draft({ title: 'B' });
    const [sa, sb] = await Promise.all([sales.send(actor, a.id), sales.send(actor, b.id)]);
    expect(new Set([sa.number, sb.number]).size).toBe(2);
  });

  // ── immutability ──

  it('freezes a sent quote, in the database as well as the service', async () => {
    const quote = await draft();
    const sent = await sales.send(actor, quote.id);

    await expect(sales.updateDraftLines(actor, sent.id, LINES)).rejects.toThrow(/revision/);
    await expect(sales.updateDraft(actor, sent.id, { title: 'Changed' })).rejects.toThrow(
      /revision/,
    );
    await expect(sales.deleteDraft(actor, sent.id)).rejects.toThrow(/reject it instead/);

    // Straight at the database, bypassing the service entirely.
    await expect(
      testDb.execute(sql`UPDATE sales.quotes SET total_cents = 1 WHERE id = ${sent.id}`),
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.execute(sql`UPDATE sales.quote_lines SET amount_cents = 1 WHERE quote_id = ${sent.id}`),
    ).rejects.toThrow(/immutable/);
    await expect(
      testDb.execute(sql`DELETE FROM sales.quotes WHERE id = ${sent.id}`),
    ).rejects.toThrow(/cannot be deleted/);
  });

  // ── revisions ──

  it('revises a sent quote into a new version, leaving the original intact', async () => {
    const first = await draft();
    const sent = await sales.send(actor, first.id);

    const v2 = await sales.revise(actor, sent.id);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('draft');
    expect(v2.number).toBeNull();
    expect(v2.supersedesQuoteId).toBe(sent.id);
    expect(v2.lines).toHaveLength(1); // carried over, ready to edit

    // The version the client saw is untouched — that is the point.
    const original = await sales.getQuote(actor, sent.id);
    expect(original.status).toBe('sent');
    expect(original.totalCents).toBe(101_640);

    // The revision prices independently.
    await sales.updateDraftLines(actor, v2.id, [
      { description: 'Power BI dashboard — verkleinde scope', quantity: '16.00', unitPriceCents: 3_500 },
    ]);
    const repriced = await sales.getQuote(actor, v2.id);
    expect(repriced.subtotalCents).toBe(56_000);
    expect((await sales.getQuote(actor, sent.id)).subtotalCents).toBe(84_000);
  });

  it('only revises quotes that have been sent', async () => {
    const quote = await draft();
    await expect(sales.revise(actor, quote.id)).rejects.toThrow(/sent/);
  });

  // ── acceptance: the seam this phase exists for ──

  it('accepting creates a project carrying the quoted rate and budget', async () => {
    const quote = await draft();
    const sent = await sales.send(actor, quote.id);

    const accepted = await sales.accept(actor, sent.id, { createProject: true });
    expect(accepted.status).toBe('accepted');
    expect(accepted.projectCreatedId).not.toBeNull();

    const project = await crm.getProject(actor, accepted.projectCreatedId!);
    expect(project.name).toBe('Power BI dashboard');
    expect(project.clientId).toBe(clientId);
    // The number that stops being retyped from memory:
    expect(project.defaultRateCents).toBe(3_500);
    expect(project.budgetAmountCents).toBe(84_000); // excluding VAT
  });

  it('can attach an accepted quote to an existing project instead', async () => {
    const existing = await crm.createProject(actor, {
      clientId,
      name: 'Running engagement',
      billingModel: 'time_and_materials',
      defaultRateCents: 3_500,
    });
    const sent = await sales.send(actor, (await draft()).id);

    const accepted = await sales.accept(actor, sent.id, { attachToProjectId: existing.id });
    expect(accepted.projectCreatedId).toBe(existing.id);

    // No second project was invented for follow-on work.
    const projects = await crm.listProjects(actor, { clientId });
    expect(projects).toHaveLength(1);
  });

  it('accepting without asking for a project creates none', async () => {
    const sent = await sales.send(actor, (await draft()).id);
    const accepted = await sales.accept(actor, sent.id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.projectCreatedId).toBeNull();
  });

  it('records a rejection with its reason', async () => {
    const sent = await sales.send(actor, (await draft()).id);
    const rejected = await sales.reject(actor, sent.id, 'Budget moved to next year');
    expect(rejected.status).toBe('rejected');
    expect(rejected.decidedAt).not.toBeNull();
  });

  it('refuses to decide twice, or to decide before sending', async () => {
    const quote = await draft();
    await expect(sales.accept(actor, quote.id)).rejects.toThrow(/sent/);

    const sent = await sales.send(actor, quote.id);
    await sales.accept(actor, sent.id);
    await expect(sales.reject(actor, sent.id)).rejects.toThrow(/already accepted/);
    await expect(sales.accept(actor, sent.id)).rejects.toThrow(/already accepted/);
  });

  it('publishes the events the pipeline and Phase 6 will listen for', async () => {
    const sent = await sales.send(actor, (await draft()).id);
    await sales.accept(actor, sent.id, { createProject: true });

    const names = (
      await testDb.execute(sql`SELECT event_name FROM core.events ORDER BY created_at`)
    ).rows.map((r) => (r as { event_name: string }).event_name);
    expect(names).toContain('quote.sent');
    expect(names).toContain('quote.accepted');
  });

  // ── listing ──

  it('filters by status and client', async () => {
    const a = await draft({ title: 'Sent one' });
    await sales.send(actor, a.id);
    await draft({ title: 'Still a draft' });

    expect(await sales.listQuotes(actor, { status: 'sent' })).toHaveLength(1);
    expect(await sales.listQuotes(actor, { status: 'draft' })).toHaveLength(1);
    expect(await sales.listQuotes(actor, { clientId })).toHaveLength(2);
  });
});
