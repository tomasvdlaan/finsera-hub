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
import { billingManifest } from '../billing/billing.manifest.js';
import { BillingService } from '../billing/billing.service.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { SalesService } from '../sales/sales.service.js';
import { timeManifest } from '../time/time.manifest.js';
import { TimeService } from '../time/time.service.js';
import { PortalProjection, type PortalVisitor } from './portal.projection.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * The adversarial pass the brief requires before any external user (§4).
 *
 * Not a re-run of the unit tests. Those check that each query behaves; this one takes a
 * session belonging to one client and tries, through every surface the portal exposes, to
 * reach a second client whose data is deliberately rich — issued invoices, sent quotes,
 * shared documents, a PDF on disk. Every assertion here is that the attempt returned
 * nothing.
 *
 * Written from the attacker's side on purpose: the ids being passed are real, valid, and
 * belong to someone else. Guessing an id is not the hard part of this attack, so no test
 * here pretends it is.
 */
describe('Portal isolation, adversarially', () => {
  let projection: PortalProjection;
  let crm: CrmService;

  let mine: string;
  let theirs: string;
  let visitor: PortalVisitor;

  // Everything belonging to the *other* client — the prizes.
  let theirInvoiceId: string;
  let theirQuoteId: string;
  let theirDocId: string;
  let theirProjectId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE portal.users, billing.invoice_lines, billing.invoices,
                   billing.invoice_counters, sales.quote_lines, sales.quotes,
                   sales.quote_counters, docs.chunks, docs.versions, docs.documents,
                   time.entries, crm.projects, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest, docsManifest, billingManifest, salesManifest]) {
      manifests.register(m);
    }
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const time = new TimeService(testDb, registry, permissions, audit, bus, links, crm);
    const docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new StorageService(), new EmbeddingService(), new FileTypeRegistry(), crm,
    );
    const settings = new SettingsService(testDb);
    const billing = new BillingService(
      testDb, registry, permissions, audit, bus, links, crm, time, docs, settings,
    );
    const sales = new SalesService(
      testDb, registry, permissions, audit, bus, links, crm, docs, settings,
    );

    await Promise.all([
      crm.ensureReportingViews(), time.ensureReportingViews(), billing.ensureReportingViews(),
      sales.ensureReportingViews(), docs.ensureReportingViews?.(),
    ]);
    await settings.update({
      legalName: 'Finsera', kvkNumber: '12345678',
      vatNumber: 'NL123456789B01', iban: 'NL00BANK0123456789',
    });

    projection = new PortalProjection(testDb, manifests);

    mine = (await crm.createClient(actor, { name: 'My client', status: 'active' })).id;
    theirs = (await crm.createClient(actor, { name: 'Another client', status: 'active' })).id;
    visitor = { portalUserId: crypto.randomUUID(), clientId: mine, email: 'me@myclient.nl' };

    // The other client, with everything a portal can show.
    const project = await crm.createProject(actor, {
      clientId: theirs, name: 'Their secret project',
      billingModel: 'time_and_materials', defaultRateCents: 9_999,
    });
    theirProjectId = project.id;
    await time.createEntry(actor, { projectId: project.id, workedOn: '2026-07-01', minutes: 120 });
    theirInvoiceId = (
      await billing.issue(actor, (await billing.draftFromHours(actor, project.id)).id)
    ).id;
    theirQuoteId = (
      await sales.send(
        actor,
        (
          await sales.createDraft(actor, {
            clientId: theirs, title: 'Their pricing',
            lines: [{ description: 'Confidential', quantity: '2.00', unitPriceCents: 250_000 }],
          })
        ).id,
      )
    ).id;
    const doc = await docs.upload(actor, {
      filename: 'their-contract.md', mimeType: 'text/markdown',
      data: Buffer.from('Their negotiated terms.'), title: 'Their contract', clientId: theirs,
    });
    theirDocId = doc.id;
    await testDb.transaction(async (tx) => {
      await links.createWithin(tx, actor, {
        fromId: doc.id, toId: theirs, kind: 'shared_with_client',
      });
    });
  });

  it('cannot list another client’s anything', async () => {
    const [projects, invoices, quotes, documents] = await Promise.all([
      projection.projects(visitor),
      projection.invoices(visitor),
      projection.quotes(visitor),
      projection.documents(visitor),
    ]);
    expect([...projects, ...invoices, ...quotes, ...documents]).toEqual([]);
  });

  it('cannot read another client’s quote lines with a valid quote id', async () => {
    // The id is real and the quote is genuinely sent. Only the ownership predicate stands
    // between this session and someone else's pricing.
    expect(await projection.quoteLines(visitor, theirQuoteId)).toEqual([]);
  });

  it('cannot fetch another client’s invoice PDF with a valid invoice id', async () => {
    expect(await projection.invoiceFile(visitor, theirInvoiceId)).toBeNull();
  });

  it('cannot fetch another client’s shared document, even though it IS shared', async () => {
    // Shared — just not with them. "A share exists" must never be mistaken for "a share
    // exists for you", which is the bug a naive EXISTS check would introduce.
    expect(await projection.documentFile(visitor, theirDocId)).toBeNull();
    expect(await projection.mayReadDocument(visitor, theirDocId)).toBe(false);
  });

  it('cannot reach anything by presenting the other client’s id as its own', async () => {
    // If a clientId ever came from the request rather than the session, this is what the
    // attack would look like. It documents why `PortalVisitor` is built by the guard and
    // never from user input.
    const forged: PortalVisitor = { ...visitor, clientId: theirs };
    expect(await projection.projects(forged)).toHaveLength(1);
    // ^ deliberately NOT a failure: the projection trusts its caller by design. The test
    // exists to pin down where that trust lives, so that any endpoint accepting a clientId
    // from a request is recognised as the bug it would be.
  });

  it('leaks nothing through a project id belonging to someone else', async () => {
    const rows = (await projection.projects(visitor)) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === theirProjectId)).toBe(false);
  });

  it('survives ids that are not ids at all', async () => {
    // Controllers use ParseUUIDPipe, so these should never arrive — but the projection is
    // reachable from two controllers and should not be the thing that assumes.
    for (const nasty of ["' OR '1'='1", '00000000-0000-0000-0000-000000000000', '']) {
      expect(await projection.quoteLines(visitor, nasty)).toEqual([]);
      expect(await projection.invoiceFile(visitor, nasty)).toBeNull();
      expect(await projection.documentFile(visitor, nasty)).toBeNull();
    }
  });

  it('shows a client their own data, so the tests above are not passing vacuously', async () => {
    // Every assertion above would also pass if the projection returned nothing, ever.
    const ours: PortalVisitor = { ...visitor, clientId: theirs };
    expect(await projection.projects(ours)).toHaveLength(1);
    expect(await projection.invoices(ours)).toHaveLength(1);
    expect(await projection.quotes(ours)).toHaveLength(1);
    expect(await projection.documents(ours)).toHaveLength(1);
    expect(await projection.quoteLines(ours, theirQuoteId)).toHaveLength(1);
    expect(await projection.invoiceFile(ours, theirInvoiceId)).not.toBeNull();
    expect(await projection.documentFile(ours, theirDocId)).not.toBeNull();
  });
});
