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
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from '../docs/docs.manifest.js';
import { DocsService } from '../docs/docs.service.js';
import { salesManifest } from '../sales/sales.manifest.js';
import { SalesService } from './sales.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/**
 * A client accepting their own quote — the first write the portal permits.
 *
 * The interesting cases are all refusals: someone else's quote, an expired price, a quote
 * that was never sent, one already decided. Each is a way a signed-in client could commit
 * us to something we did not offer them.
 */
describe('SalesService.acceptByClient', () => {
  let sales: SalesService;
  let crm: CrmService;
  let ours: string;
  let theirs: string;

  const visitor = { portalUserId: crypto.randomUUID(), email: 'them@aclient.nl' };

  const quoteFor = async (clientId: string, validUntil?: string) =>
    sales.createDraft(actor, {
      clientId,
      title: 'Some work',
      validUntil,
      lines: [{ description: 'Work', quantity: '1.00', unitPriceCents: 100_000 }],
    });

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE sales.quote_lines, sales.quotes, sales.quote_counters,
                   docs.chunks, docs.versions, docs.documents, crm.projects, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, docsManifest, salesManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    const docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new StorageService(), new EmbeddingService(), new FileTypeRegistry(), crm, new LlmService(),
    );
    const settings = new SettingsService(testDb);
    sales = new SalesService(testDb, registry, permissions, audit, bus, links, crm, docs, settings);

    await Promise.all([crm.ensureReportingViews(), sales.ensureReportingViews()]);
    await settings.update({
      legalName: 'Finsera', kvkNumber: '12345678',
      vatNumber: 'NL123456789B01', iban: 'NL00BANK0123456789',
    });

    ours = (await crm.createClient(actor, { name: 'Our client', status: 'active' })).id;
    theirs = (await crm.createClient(actor, { name: 'Someone else', status: 'active' })).id;
  });

  it('accepts a sent quote belonging to the client', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);

    const result = await sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor });
    expect(result.status).toBe('accepted');
    expect((await sales.getQuote(actor, quote.id)).status).toBe('accepted');
  });

  it('refuses another client’s quote, with the same message as a missing one', async () => {
    const quote = await sales.send(actor, (await quoteFor(theirs)).id);

    // Not "forbidden", which would confirm the quote exists. A stranger probing ids
    // should not be able to map out which ones are real.
    await expect(
      sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor }),
    ).rejects.toThrow(/Not found/);
    expect((await sales.getQuote(actor, quote.id)).status).toBe('sent');
  });

  it('refuses a quote that was never sent', async () => {
    const draft = await quoteFor(ours);
    await expect(
      sales.acceptByClient({ quoteId: draft.id, clientId: ours, ...visitor }),
    ).rejects.toThrow(/Not found/);
  });

  it('refuses a price that has lapsed', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours, '2020-01-01')).id);

    // The portal marks these expired, so this is the second line of defence — but an old
    // browser tab or a crafted request must not be able to claim a price we withdrew.
    await expect(
      sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor }),
    ).rejects.toThrow(/expired/);
    expect((await sales.getQuote(actor, quote.id)).status).toBe('sent');
  });

  it('refuses a second acceptance, and says why', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);
    await sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor });

    // A client re-clicking a quote they already accepted has demonstrably seen it, so
    // here a plain sentence beats the deliberately vague 404 used above.
    await expect(
      sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor }),
    ).rejects.toThrow(/already accepted/);
  });

  it('cannot revive a rejected quote', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);
    await sales.reject(actor, quote.id, 'too expensive');

    await expect(
      sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor }),
    ).rejects.toThrow(/already rejected/);
  });

  it('records the portal user who accepted, not an internal one', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);
    await sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor });

    const { rows } = await testDb.execute(sql`
      SELECT actor_id, detail FROM core.audit_log
       WHERE action = 'quote.accept' AND entity_id = ${quote.id}
    `);
    expect(rows).toHaveLength(1);
    const row = rows[0] as { actor_id: string | null; detail: Record<string, unknown> };
    // Null rather than borrowed: the column is a foreign key into core.users, and a
    // portal visitor is not one. Attributing this to an employee would be a false record.
    expect(row.actor_id).toBeNull();
    expect(row.detail).toMatchObject({ viaPortal: true, acceptedByPortalUser: visitor.portalUserId });
  });

  it('publishes the same event an internal acceptance would', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);
    await sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor });

    // Anything downstream should see one kind of "a quote was accepted" rather than
    // having to know which door it came through.
    const { rows } = await testDb.execute(sql`
      SELECT event_name, payload FROM core.events
       WHERE entity_id = ${quote.id} AND event_name = 'quote.accepted'
    `);
    expect(rows).toHaveLength(1);
  });

  it('does not create a project on the client’s behalf', async () => {
    const quote = await sales.send(actor, (await quoteFor(ours)).id);
    await sales.acceptByClient({ quoteId: quote.id, clientId: ours, ...visitor });

    // Internally, accepting can spin up a project with a budget from the quote. That is a
    // decision about how we run the work, not one a client makes by clicking a button.
    const { rows } = await testDb.execute(sql`SELECT 1 FROM crm.projects`);
    expect(rows).toHaveLength(0);
  });
});
