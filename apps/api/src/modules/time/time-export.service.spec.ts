import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@platform/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { ManifestRegistry } from '../../core/manifest/manifest.registry.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { UserService } from '../../core/auth/user.service.js';
import type { ZitadelTokens } from '../../core/auth/zitadel.tokens.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { LocalDocumentStore } from '../../core/storage/local-document-store.js';
import { SharePointDocumentStore } from '../../core/storage/sharepoint-document-store.js';
import { GraphClient } from '../../core/graph/graph.client.js';
import { FakeGraphDrive } from '../../test/fake-graph.js';
import { resetDb, seedUser, testDb, truncate } from '../../test/db.js';
import { crmManifest } from '../crm/crm.manifest.js';
import { CrmService } from '../crm/crm.service.js';
import { timeManifest } from './time.manifest.js';
import { TimeService } from './time.service.js';
import { TimeExportService } from './time-export.service.js';

const actor: Actor = { userId: crypto.randomUUID(), role: 'admin' };

/** Enough of a GraphClient to say "configured". Nothing here touches the network. */
const configuredGraph = () => {
  const graph = new GraphClient();
  Object.defineProperty(graph, 'configured', { get: () => true });
  return graph;
};

describe('the monthly hours ledger', () => {
  let time: TimeService;
  let exporter: TimeExportService;
  let drive: FakeGraphDrive;
  let projectId: string;

  const build = async (store: LocalDocumentStore | SharePointDocumentStore) => {
    const manifests = new ManifestRegistry();
    for (const m of [crmManifest, timeManifest]) manifests.register(m);
    manifests.seal();

    const registry = new RegistryService(testDb, manifests);
    const permissions = new PermissionService(testDb, manifests);
    const audit = new AuditService(testDb);
    const links = new LinkService(testDb, registry, permissions, audit, manifests);
    const bus = new EventBus(manifests);
    const crm = new CrmService(testDb, registry, permissions, audit, bus, links);
    // Only namesByIds is exercised here, and it touches neither the audit log nor the
    // token verifier — the same shortcut portal-preview.controller.spec.ts takes.
    const users = new UserService(testDb, audit, {} as unknown as ZitadelTokens);

    exporter = new TimeExportService(testDb, registry, users, store);
    time = new TimeService(testDb, registry, permissions, audit, bus, links, crm, exporter);

    // Reading crm.v_projects means the view has to be there; a hand-built service graph
    // has had no boot to create it.
    await crm.ensureReportingViews();

    const client = await crm.createClient(actor, { name: 'Plibs B.V.', status: 'active' });
    projectId = (
      await crm.createProject(actor, {
        clientId: client.id,
        name: 'Jaarrekening',
        billingModel: 'time_and_materials',
        defaultRateCents: 9000,
      })
    ).id;
  };

  beforeEach(async () => {
    await resetDb();
    await truncate(sql`TRUNCATE time.exports, time.entries, time.timesheets,
                   crm.projects, crm.contacts, crm.clients CASCADE`);
    await seedUser(actor.userId, 'admin', 'Tomas van der Laan');
    drive = new FakeGraphDrive();
    await build(new SharePointDocumentStore(drive, configuredGraph()));
  });

  const log = (workedOn: string, minutes: number, description?: string) =>
    time.createEntry(actor, { projectId, workedOn, minutes, billable: true, description });

  const csvOf = async (itemId: string) => (await drive.download(itemId)).toString('utf8');

  it('writes a month to the exports folder, not into a client folder', async () => {
    await log('2026-09-03', 90, 'Jaarrekening 2025');
    const result = await exporter.flush();

    expect(result.written).toEqual(['2026-09']);
    const files = await drive.listAll();
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toContain('_Exports');
    expect(files[0]?.name).toBe('uren-2026-09.csv');

    const csv = await csvOf(files[0]!.id);
    expect(csv).toContain('Jaarrekening 2025');
    // Names, not ids: the point of the file is that it survives the platform that made it.
    expect(csv).toContain('Plibs B.V.');
  });

  /**
   * A name, not a uuid.
   *
   * People are not registry entities, so the registry-based lookup that resolves clients and
   * projects silently fell through to the raw id for the one column a person reads first.
   */
  it('names the person rather than printing their id', async () => {
    await log('2026-09-03', 90);
    await exporter.flush();

    const csv = await csvOf((await drive.listAll())[0]!.id);
    expect(csv).toContain('Tomas van der Laan');
    expect(csv).not.toContain(actor.userId);
  });

  /**
   * The property the whole design rests on.
   *
   * The exporter runs every few minutes. Without this check a quiet afternoon would produce
   * a version every run, the library's version cap would be gone within weeks, and the
   * history — the actual reason for putting this in SharePoint — would be unreadable.
   */
  it('writes nothing when the month has not changed', async () => {
    await log('2026-09-03', 90);
    await exporter.flush();
    const itemId = (await drive.listAll())[0]!.id;
    drive.calls.length = 0;

    exporter.markDirty('2026-09-03');
    const second = await exporter.flush();

    expect(second.written).toEqual([]);
    expect(second.unchanged).toEqual(['2026-09']);
    expect(drive.calls.filter((c) => c.startsWith('replaceContent'))).toEqual([]);
    expect(await drive.listAll()).toHaveLength(1);
    expect(itemId).toBe((await drive.listAll())[0]!.id);
  });

  it('replaces the same file when the month does change', async () => {
    await log('2026-09-03', 90);
    await exporter.flush();
    const before = (await drive.listAll())[0]!;

    await log('2026-09-04', 30, 'Bankmutaties');
    const result = await exporter.flush();
    const after = (await drive.listAll())[0]!;

    expect(result.written).toEqual(['2026-09']);
    // Same item: one file per month with a history, not a new file per write.
    expect(after.id).toBe(before.id);
    expect(await csvOf(after.id)).toContain('Bankmutaties');
  });

  /** A deletion is the one change that leaves nothing behind in the database to notice. */
  it('reflects a deleted entry', async () => {
    const entry = await log('2026-09-03', 90, 'Weggehaald');
    await exporter.flush();

    await time.deleteEntry(actor, entry.id);
    await exporter.flush();

    expect(await csvOf((await drive.listAll())[0]!.id)).not.toContain('Weggehaald');
  });

  /**
   * Moving an entry across a month boundary changes two ledgers. Marking only the new month
   * would leave the old one quietly overstated, which is the kind of wrong nobody catches.
   */
  it('rewrites both months when an entry moves across a boundary', async () => {
    const entry = await log('2026-08-31', 60, 'Verschoven');
    await exporter.flush();

    await time.updateEntry(actor, entry.id, { workedOn: '2026-09-01' });
    const result = await exporter.flush();

    expect(result.written.sort()).toEqual(['2026-08', '2026-09']);
    const byName = new Map((await drive.listAll()).map((f) => [f.name, f.id]));
    expect(await csvOf(byName.get('uren-2026-08.csv')!)).not.toContain('Verschoven');
    expect(await csvOf(byName.get('uren-2026-09.csv')!)).toContain('Verschoven');
  });

  /** A running timer is not yet an hour worked; exporting it would put a moving number in. */
  it('leaves a running timer out of the ledger', async () => {
    await time.createEntry(actor, {
      projectId,
      workedOn: '2026-09-05',
      billable: true,
      startedAt: new Date('2026-09-05T09:00:00Z').toISOString(),
    });
    const result = await exporter.flush();

    expect(result.written).toEqual([]);
    expect(await drive.listAll()).toHaveLength(0);
  });

  /**
   * The exports are the platform's own output. Offering to "file" them every fifteen minutes
   * would make the one screen whose job is adopting what a person moved in useless.
   */
  it('keeps its own files out of the Unfiled screen', async () => {
    await log('2026-09-03', 90);
    await exporter.flush();

    const store = new SharePointDocumentStore(drive, configuredGraph());
    expect(await store.listUnfiled(new Set())).toEqual([]);
  });

  /**
   * A deploy in the middle of somebody's debounce window must not lose their afternoon.
   *
   * The dirty set is in memory and the next flush only writes months it has been told about,
   * so a dropped window is a gap nothing afterwards would know to go looking for.
   */
  it('writes what is pending when the process shuts down', async () => {
    await log('2026-09-03', 90, 'Net voor de deploy');
    expect(await drive.listAll()).toHaveLength(0);

    await exporter.onModuleDestroy();

    const files = await drive.listAll();
    expect(files).toHaveLength(1);
    expect(await csvOf(files[0]!.id)).toContain('Net voor de deploy');
  });

  it('does nothing at all when documents are not in SharePoint', async () => {
    await build(new LocalDocumentStore(new StorageService()));
    await log('2026-09-03', 90);

    expect(await exporter.flush()).toEqual({ written: [], unchanged: [] });
    expect(await drive.listAll()).toHaveLength(0);
  });
});
