import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { CrmService } from '../crm/crm.service.js';
import { decryptPageSecret } from './page-secrets.js';
import { PortalPagesService } from './portal-pages.service.js';
import { portalManifest } from './portal.manifest.js';
import { portalPages } from './portal.schema.js';

const admin: Actor = { userId: crypto.randomUUID(), role: 'admin' };
const member: Actor = { userId: crypto.randomUUID(), role: 'member' };

describe('PortalPagesService', () => {
  let pages: PortalPagesService;
  let crm: CrmService;
  let clientId: string;
  const env = { ...process.env };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE portal.pages, crm.projects, crm.clients CASCADE`);
    await seedUser(admin.userId, 'admin');
    await seedUser(member.userId, 'member');
    // 32 bytes, so a bypass secret can be stored at all.
    process.env.PORTAL_PAGE_KEY = Buffer.alloc(32, 7).toString('base64');

    const manifests = new ManifestRegistry();
    manifests.register(crmManifest);
    manifests.register(portalManifest);
    manifests.seal();
    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService();
    crm = new CrmService(
      testDb, registry, permissions, audit,
      new EventBus(manifests), new LinkService(testDb, registry, permissions, audit, manifests),
    );
    pages = new PortalPagesService(testDb, permissions, audit);
    clientId = (await crm.createClient(admin, { name: 'Duce', status: 'active' })).id;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const valid = {
    slug: 'rapportage-q3',
    title: 'Rapportage Q3',
    sourceUrl: 'https://rapportage-q3-duce.vercel.app',
  };

  it('creates a page and shows the client a title and a link, never the source', async () => {
    await pages.create(admin, clientId, valid);
    const forClient = await pages.forClient(clientId);
    expect(forClient).toEqual([{ slug: 'rapportage-q3', title: 'Rapportage Q3', kind: 'proxy' }]);
    // The source URL is the thing the whole proxy exists to keep out of the browser.
    expect(JSON.stringify(forClient)).not.toContain('vercel');
  });

  it('is admin-only, like every other way of handing data to an outsider', async () => {
    await expect(pages.create(member, clientId, valid)).rejects.toThrow(/portal.admin/);
    await expect(pages.list(member, clientId)).rejects.toThrow(/portal.admin/);
  });

  it('refuses a page named after one the portal already has', async () => {
    // The proxy runs before the SPA, so a page called `facturen` would take the invoices
    // tab away and nothing would say why.
    for (const slug of ['facturen', 'offertes', 'api', 'assets', 'rapporten']) {
      await expect(pages.create(admin, clientId, { ...valid, slug }), slug).rejects.toThrow(
        /already has/,
      );
    }
  });

  it('refuses a malformed address, and lowercases a shouted one', async () => {
    for (const slug of ['a', 'Rapport age', 'rapport_q3', '-q3', 'q3-', 'x'.repeat(61)]) {
      await expect(pages.create(admin, clientId, { ...valid, slug }), slug).rejects.toThrow(
        /page address/i,
      );
    }
    await pages.create(admin, clientId, { ...valid, slug: 'RAPPORT-Q3' });
    expect((await pages.forClient(clientId))[0]?.slug).toBe('rapport-q3');
  });

  it('gives the same slug to two clients, because the hostname separates them', async () => {
    const other = (await crm.createClient(admin, { name: 'DocHorse', status: 'active' })).id;
    await pages.create(admin, clientId, valid);
    await expect(pages.create(admin, other, valid)).resolves.toBeTruthy();
    // …but not twice to one.
    await expect(pages.create(admin, clientId, valid)).rejects.toThrow(/already has a page/);
  });

  // ── where content may come from ──

  it('refuses a source that is not https', async () => {
    for (const sourceUrl of ['http://report.example', 'ftp://report.example', 'not a url']) {
      await expect(
        pages.create(admin, clientId, { ...valid, sourceUrl }),
        sourceUrl,
      ).rejects.toThrow(/https|not a URL/);
    }
  });

  it('refuses an address inside our own network', async () => {
    // This is the only place an internal user's text becomes a server-side request, so
    // without this somebody holding portal.admin could read the metadata service, the
    // database port, or anything else the container can reach — in a client's browser.
    for (const sourceUrl of [
      'https://127.0.0.1/admin',
      'https://10.0.0.5/',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/',
      'https://192.168.1.1/',
    ]) {
      await expect(
        pages.create(admin, clientId, { ...valid, sourceUrl }),
        sourceUrl,
      ).rejects.toThrow(/our own network/);
    }
  });

  it('refuses credentials smuggled into the URL', async () => {
    await expect(
      pages.create(admin, clientId, { ...valid, sourceUrl: 'https://user:pw@report.vercel.app' }),
    ).rejects.toThrow(/Credentials/);
  });

  // ── the bypass secret ──

  it('stores a bypass secret encrypted, and never reads it back to a person', async () => {
    await pages.create(admin, clientId, { ...valid, bypassSecret: 'vercel-secret-value' });
    const [row] = await testDb.select().from(portalPages);

    expect(row?.bypassSecretEnc).not.toContain('vercel-secret-value');
    expect(decryptPageSecret(row!.bypassSecretEnc)).toBe('vercel-secret-value');
    // The admin list says whether one is set, which is the only shape that lets somebody
    // see the state without seeing the credential.
    const [listed] = await pages.list(admin, clientId);
    expect(listed).toMatchObject({ hasSecret: true });
    expect(JSON.stringify(listed)).not.toContain('vercel-secret-value');
  });

  it('leaves a stored secret alone when an edit does not mention it', async () => {
    const { id } = await pages.create(admin, clientId, { ...valid, bypassSecret: 'keep-me' });
    await pages.update(admin, id, { title: 'Rapportage Q3 (herzien)' });

    // A form that posts every field must not erase a credential it never showed anybody.
    const [row] = await testDb.select().from(portalPages);
    expect(decryptPageSecret(row!.bypassSecretEnc)).toBe('keep-me');
    // …and null still clears it, deliberately.
    await pages.update(admin, id, { bypassSecret: null });
    const [after] = await testDb.select().from(portalPages);
    expect(after?.bypassSecretEnc).toBeNull();
  });

  it('refuses to store a secret with no key to encrypt it with', async () => {
    delete process.env.PORTAL_PAGE_KEY;
    // Rather than writing it in the clear "for now", which is the version nobody revisits.
    await expect(
      pages.create(admin, clientId, { ...valid, bypassSecret: 'nowhere-to-put-this' }),
    ).rejects.toThrow(/PORTAL_PAGE_KEY/);
    // A page without a secret is still fine — plenty of reports are not protected.
    await expect(pages.create(admin, clientId, valid)).resolves.toBeTruthy();
  });

  // ── serving ──

  it('finds an enabled page by slug, and stops finding a disabled one', async () => {
    const { id } = await pages.create(admin, clientId, valid);
    expect(await pages.find(clientId, 'rapportage-q3')).toMatchObject({ id });

    await pages.update(admin, id, { enabled: false });
    expect(await pages.find(clientId, 'rapportage-q3')).toBeNull();
    expect(await pages.forClient(clientId)).toEqual([]);
  });

  it('never finds another client’s page', async () => {
    const other = (await crm.createClient(admin, { name: 'DocHorse', status: 'active' })).id;
    await pages.create(admin, clientId, valid);
    // The proxy looks up by (client from the hostname, slug from the path); this is the
    // half that makes a guessed slug worth nothing.
    expect(await pages.find(other, 'rapportage-q3')).toBeNull();
  });

  it('records what was created and removed, with the source URL', async () => {
    const { id } = await pages.create(admin, clientId, valid);
    await pages.remove(admin, id);
    const { rows } = await testDb.execute<{ action: string; detail: Record<string, unknown> }>(
      sql`SELECT action, detail FROM core.audit_log WHERE action LIKE 'portal.page.%' ORDER BY id`,
    );
    // "Where did that report actually come from" is asked months later, when the row is gone.
    expect(rows.map((r) => r.action)).toEqual(['portal.page.create', 'portal.page.delete']);
    expect(rows[0]?.detail).toMatchObject({ sourceUrl: valid.sourceUrl });
  });
});
