import { beforeEach, describe, expect, it } from 'vitest';
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
import { testDb } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { docsManifest } from './docs.manifest.js';
import { DocsService } from './docs.service.js';

/**
 * What docs.v_documents publishes, pinned.
 *
 * This view is not an internal detail: the portal reads it to resolve a file a client is
 * entitled to, so widening it widens what can reach a client. The list is written out here
 * so that adding a column is a decision somebody makes on purpose, in a diff that says so,
 * rather than a side effect of adding a column to the table.
 */
const PUBLISHED = [
  'id',
  'title',
  'category',
  'client_id',
  'project_id',
  'scope',
  'version',
  'filename',
  'mime_type',
  'size_bytes',
  'storage_backend',
  'storage_key',
  'drive_id',
  'drive_item_id',
  'indexed_at',
  'remote_modified_at',
  'missing_at',
  'indexed',
  'uploaded_by',
  'created_at',
  'updated_at',
];

describe('docs.v_documents', () => {
  let columns: string[];

  beforeEach(async () => {
    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, docsManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);

    const docs = new DocsService(
      testDb, registry, permissions, audit, bus, links,
      new LocalDocumentStore(new StorageService()),
      new EmbeddingService(), new FileTypeRegistry(),
      new CrmService(testDb, registry, permissions, audit, bus, links),
      new LlmService(),
    );
    await docs.ensureReportingViews();

    const { rows } = await testDb.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'docs' AND table_name = 'v_documents'
       ORDER BY ordinal_position
    `);
    columns = rows.map((r) => (r as { column_name: string }).column_name);
  });

  it('publishes exactly the columns it is meant to', () => {
    expect(columns).toEqual(PUBLISHED);
  });

  /**
   * The one column that must never appear here.
   *
   * web_url is a link into a library holding every other client's documents. The portal
   * builds its FileRef from this view, so a web_url in the view is one careless SELECT away
   * from a web_url in a portal response — and a client who received one would hold a door
   * the whole visibility model exists to keep shut.
   */
  it('does not publish the SharePoint web URL', () => {
    expect(columns).not.toContain('web_url');
    expect(columns).not.toContain('sharepoint_path');
    expect(columns).not.toContain('extracted_text');
  });

  /** Enough to resolve where the bytes are, or the portal cannot serve a document at all. */
  it('publishes enough for the portal to resolve a file', () => {
    for (const needed of ['storage_backend', 'storage_key', 'drive_id', 'drive_item_id']) {
      expect(columns).toContain(needed);
    }
  });
});
