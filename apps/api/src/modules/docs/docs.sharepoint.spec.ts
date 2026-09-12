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
import { StorageService } from '../../core/storage/storage.service.js';
import { LocalDocumentStore } from '../../core/storage/local-document-store.js';
import { SharePointDocumentStore } from '../../core/storage/sharepoint-document-store.js';
import { GraphClient } from '../../core/graph/graph.client.js';
import { FakeGraphDrive } from '../../test/fake-graph.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from './docs.manifest.js';
import { DocsService } from './docs.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** Enough of a GraphClient to say "yes, configured". Nothing here makes a request. */
const configuredGraph = () => {
  const graph = new GraphClient();
  Object.defineProperty(graph, 'configured', { get: () => true });
  return graph;
};

const upload = (over: Partial<Parameters<DocsService['upload']>[1]> = {}) => ({
  filename: 'contract.txt',
  mimeType: 'text/plain',
  data: Buffer.from('The notice period is one month.'),
  ...over,
});

describe('documents in SharePoint', () => {
  let docs: DocsService;
  let crm: CrmService;
  let drive: FakeGraphDrive;
  let clientId: string;

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE docs.chunks, docs.versions, docs.documents,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin');

    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, docsManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    crm = new CrmService(testDb, registry, permissions, audit, bus, links);

    drive = new FakeGraphDrive();
    docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new SharePointDocumentStore(drive, configuredGraph()),
      new EmbeddingService(), new FileTypeRegistry(), crm, new LlmService(),
    );

    const client = await crm.createClient(actor, { name: 'Plibs B.V.', status: 'active' });
    clientId = client.id;
  });

  const versionRow = async (documentId: string) => {
    const { rows } = await testDb.execute(sql`
      SELECT * FROM docs.versions WHERE document_id = ${documentId}
       ORDER BY version DESC LIMIT 1
    `);
    return rows[0] as Record<string, unknown>;
  };

  it('files a document into its client folder and records the pointer', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    const row = await versionRow(doc.id);

    expect(row.storage_backend).toBe('sharepoint');
    expect(row.drive_item_id).toBeTruthy();
    expect(row.storage_key).toBeNull();
    // Ours, not Graph's: its own hash is quickXorHash, and the audit story wants sha256.
    expect(row.checksum).toHaveLength(64);
    expect(drive.calls).toContain('ensureFolder:Clients/Plibs B.V.');
  });

  /**
   * A name collision is resolved by SharePoint renaming the file. Storing the name we asked
   * for would mean the record and the library disagree from the very first row.
   */
  it('stores the name SharePoint returned, not the one requested', async () => {
    await docs.upload(actor, upload({ clientId }));
    const second = await docs.upload(actor, upload({ clientId }));

    expect((await versionRow(second.id)).filename).not.toBe('contract.txt');
  });

  /**
   * The cheap half. Somebody edited the file in Word Online; asking must notice, and must
   * not pay for an extraction or an embedding to do it.
   */
  it('reports a change from one metadata call, without re-reading the file', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    const itemId = (await versionRow(doc.id)).drive_item_id as string;

    drive.touch(itemId, Buffer.from('The notice period is three months.'));
    drive.calls.length = 0;

    const result = await docs.checkRemote(actor, doc.id);

    expect(result.changed).toBe(true);
    expect(result.remoteModifiedBy).toBe('Jan Bakker');
    expect(drive.calls).toEqual([`stat:${itemId}`]);
  });

  /**
   * The case that would otherwise poison the whole feature: somebody sets a column in
   * SharePoint, eTag moves, and — under manual indexing — the document reads as out of date
   * forever, because re-reading a file whose contents never changed cannot clear it.
   */
  it('does not call a metadata-only edit a change', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    drive.touchMetadataOnly((await versionRow(doc.id)).drive_item_id as string);

    expect((await docs.checkRemote(actor, doc.id)).changed).toBe(false);
  });

  it('picks up the new text on sync, as a version nobody uploaded here', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    const itemId = (await versionRow(doc.id)).drive_item_id as string;
    drive.touch(itemId, Buffer.from('The notice period is three months.'));

    const result = await docs.sync(actor, doc.id);
    const row = await versionRow(doc.id);

    expect(result.changed).toBe(true);
    expect(row.version).toBe(2);
    expect(row.origin).toBe('sync');
    expect(row.extracted_text).toContain('three months');
    // Same item: a link somebody pinned in Teams still points at the current document.
    expect(row.drive_item_id).toBe(itemId);
    expect(row.indexed_at).not.toBeNull();
  });

  it('adds no version when nothing changed', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    const result = await docs.sync(actor, doc.id);

    expect(result.changed).toBe(false);
    expect((await versionRow(doc.id)).version).toBe(1);
  });

  /**
   * The file is gone; the record is not.
   *
   * Its text and its chunks are still true and still answer questions — it is the file that
   * is missing, and a screen can say so far more usefully than a document that vanishes.
   */
  it('marks a document missing without losing what it said', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    drive.remove((await versionRow(doc.id)).drive_item_id as string);

    const result = await docs.sync(actor, doc.id);
    const row = await versionRow(doc.id);
    const { rows: chunkRows } = await testDb.execute(
      sql`SELECT count(*)::int AS n FROM docs.chunks WHERE document_id = ${doc.id}`,
    );

    expect(result.missing).toBe(true);
    expect(row.missing_at).not.toBeNull();
    expect(row.extracted_text).toContain('notice period');
    expect((chunkRows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  /** A new version replaces the content of the same item — that is what makes an SP version. */
  it('replaces content in place when a version is added', async () => {
    const doc = await docs.upload(actor, upload({ clientId }));
    const itemId = (await versionRow(doc.id)).drive_item_id as string;

    await docs.addVersion(actor, doc.id, upload({ data: Buffer.from('Revised.') }));
    const row = await versionRow(doc.id);

    expect(row.drive_item_id).toBe(itemId);
    expect(drive.calls).toContain(`replaceContent:${itemId}`);
  });

  // ── files somebody put in the library by hand ──────────────

  it('lists only library files it has no row for, and forgets them once filed', async () => {
    await docs.upload(actor, upload({ clientId }));
    const looseId = drive.seed('Raamovereenkomst.docx', Buffer.from('Artikel 1 — Definities'));

    expect((await docs.listUnfiled(actor)).map((u) => u.itemId)).toEqual([looseId]);

    await docs.fileUnfiled(actor, looseId, { title: 'Raamovereenkomst', scope: 'org' });

    expect(await docs.listUnfiled(actor)).toEqual([]);
  });

  /**
   * The templates and the prospect quotes: real documents belonging to no client, which the
   * original has-a-home constraint made unfileable without inventing a placeholder client.
   */
  it('files an org-level document with no client and no project', async () => {
    const looseId = drive.seed('Algemene Voorwaarden.txt', Buffer.from('Artikel 1'));
    const doc = await docs.fileUnfiled(actor, looseId, { scope: 'org' });

    expect(doc.clientId).toBeNull();
    expect((await versionRow(doc.id)).origin).toBe('adopted');
  });

  it('refuses to file a document with no home at all', async () => {
    const looseId = drive.seed('Stray.txt', Buffer.from('x'));
    await expect(docs.fileUnfiled(actor, looseId, {})).rejects.toThrow(/client/i);
  });

  // ── the local backend keeps working, forever ───────────────

  /**
   * Rows written before D8 keep `storage_backend = 'local'` and keep working through the
   * local store indefinitely. This is not a shim awaiting deletion: it is also what a Graph
   * failure falls back to, and what every other spec in the suite runs on.
   */
  it('still stores and serves a document on local disk', async () => {
    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, docsManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    const local = new DocsService(
      testDb, registry, permissions, audit,
      new EventBus(manifests),
      new LinkService(testDb, registry, permissions, audit, manifests),
      new LocalDocumentStore(new StorageService()),
      new EmbeddingService(), new FileTypeRegistry(), crm, new LlmService(),
    );

    const doc = await local.upload(actor, upload({ clientId, filename: 'legacy.txt' }));
    const row = await versionRow(doc.id);
    const { data } = await local.download(actor, doc.id);

    expect(row.storage_backend).toBe('local');
    expect(row.storage_key).toBeTruthy();
    expect(row.drive_item_id).toBeNull();
    expect(data.toString()).toContain('notice period');
  });
});
