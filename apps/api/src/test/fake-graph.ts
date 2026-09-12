import { createHash } from 'node:crypto';
import type { DriveApi, DriveItem } from '../core/graph/graph.types.js';

/**
 * A SharePoint drive in a Map (decision D8).
 *
 * The whole point of `DriveApi` being narrow is that this can exist: every test above the
 * Graph client runs against real bytes and real item ids without a network, a tenant, or a
 * credential. `src/test/setup.ts` keeps DOCS_STORE on 'local' so nothing reaches Microsoft
 * by accident; a test that wants SharePoint behaviour injects this on purpose.
 *
 * It models the three things the platform actually depends on and nothing else: that an
 * item id survives a rename, that replacing content changes the cTag, and that a file can
 * disappear out from under a stored pointer.
 */
export class FakeGraphDrive implements DriveApi {
  private readonly items = new Map<string, Entry>();
  private readonly folders = new Map<string, string>(); // path -> id
  private seq = 0;

  /** Every call that went out, so a test can assert something was NOT re-read. */
  readonly calls: string[] = [];

  async driveId(): Promise<string> {
    return 'fake-drive';
  }

  async ensureFolder(segments: string[]): Promise<string> {
    this.calls.push(`ensureFolder:${segments.join('/')}`);
    const path = segments.join('/');
    const existing = this.folders.get(path);
    if (existing) return existing;

    const id = `folder-${++this.seq}`;
    this.folders.set(path, id);
    return id;
  }

  async upload(folderItemId: string, filename: string, data: Buffer): Promise<DriveItem> {
    this.calls.push(`upload:${filename}`);
    const folderPath = [...this.folders.entries()].find(([, id]) => id === folderItemId)?.[0] ?? '';

    // Conflict-rename, as Graph does — and the RETURNED name is what the caller must store.
    let name = filename;
    let n = 1;
    while ([...this.items.values()].some((e) => e.folderId === folderItemId && e.name === name)) {
      const dot = filename.lastIndexOf('.');
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : '';
      name = `${stem} ${++n}${ext}`;
    }

    const id = `item-${++this.seq}`;
    this.items.set(id, {
      id,
      name,
      folderId: folderItemId,
      path: folderPath ? `${folderPath}/${name}` : name,
      data,
      cTag: tagOf(data),
      eTag: tagOf(data),
      lastModifiedAt: new Date().toISOString(),
      lastModifiedBy: 'Finsera Dashboard',
      versions: [],
    });
    return this.itemOf(id);
  }

  async replaceContent(itemId: string, data: Buffer): Promise<DriveItem> {
    this.calls.push(`replaceContent:${itemId}`);
    const entry = this.mustGet(itemId);
    entry.versions.push({ id: `v${entry.versions.length + 1}`, data: entry.data });
    entry.data = data;
    entry.cTag = tagOf(data);
    entry.eTag = tagOf(data);
    entry.lastModifiedAt = new Date().toISOString();
    entry.lastModifiedBy = 'Finsera Dashboard';
    return this.itemOf(itemId);
  }

  async stat(itemId: string): Promise<DriveItem | null> {
    this.calls.push(`stat:${itemId}`);
    return this.items.has(itemId) ? this.itemOf(itemId) : null;
  }

  async download(itemId: string, versionId?: string): Promise<Buffer> {
    this.calls.push(`download:${itemId}`);
    const entry = this.mustGet(itemId);
    if (!versionId) return entry.data;

    const version = entry.versions.find((v) => v.id === versionId);
    if (!version) throw new Error(`No version ${versionId} of ${itemId}`);
    return version.data;
  }

  async listAll(): Promise<DriveItem[]> {
    this.calls.push('listAll');
    return [...this.items.keys()].map((id) => this.itemOf(id));
  }

  /* ── test-only ─────────────────────────────────────────────────────────────────────── */

  /**
   * Somebody edited the file in Word Online.
   *
   * New bytes, a new cTag, a later timestamp, and — the part that matters — a REAL PERSON as
   * lastModifiedBy rather than the app identity. That asymmetry is the whole argument for
   * displaying "changed in SharePoint by X" as a separate fact from "uploaded by Y".
   */
  touch(itemId: string, data: Buffer, by = 'Jan Bakker'): void {
    const entry = this.mustGet(itemId);
    entry.versions.push({ id: `v${entry.versions.length + 1}`, data: entry.data });
    entry.data = data;
    entry.cTag = tagOf(data);
    entry.eTag = tagOf(data);
    entry.lastModifiedAt = new Date(Date.now() + 60_000).toISOString();
    entry.lastModifiedBy = by;
  }

  /** Metadata changed but the bytes did not — the case that must NOT read as out of date. */
  touchMetadataOnly(itemId: string): void {
    const entry = this.mustGet(itemId);
    entry.eTag = `${entry.eTag}-meta`;
    entry.lastModifiedAt = new Date(Date.now() + 60_000).toISOString();
  }

  /** Moved out of the library, or deleted. The stored pointer now resolves to nothing. */
  remove(itemId: string): void {
    this.items.delete(itemId);
  }

  /** Drop a file in as if somebody copied it in from Explorer — no document row anywhere. */
  seed(name: string, data: Buffer, folder = 'Loose'): string {
    const folderId = `folder-seed-${folder}`;
    this.folders.set(folder, folderId);
    const id = `item-${++this.seq}`;
    this.items.set(id, {
      id,
      name,
      folderId,
      path: `${folder}/${name}`,
      data,
      cTag: tagOf(data),
      eTag: tagOf(data),
      lastModifiedAt: new Date().toISOString(),
      lastModifiedBy: 'Öner Yücel',
      versions: [],
    });
    return id;
  }

  private mustGet(itemId: string): Entry {
    const entry = this.items.get(itemId);
    if (!entry) throw new Error(`No such item ${itemId}`);
    return entry;
  }

  private itemOf(id: string): DriveItem {
    const e = this.mustGet(id);
    return {
      id: e.id,
      name: e.name,
      size: e.data.byteLength,
      cTag: e.cTag,
      eTag: e.eTag,
      webUrl: `https://example.sharepoint.com/sites/Docs/${encodeURIComponent(e.name)}`,
      path: e.path,
      lastModifiedAt: e.lastModifiedAt,
      lastModifiedBy: e.lastModifiedBy,
      folder: false,
    };
  }
}

interface Entry {
  id: string;
  name: string;
  folderId: string;
  path: string;
  data: Buffer;
  cTag: string;
  eTag: string;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
  versions: Array<{ id: string; data: Buffer }>;
}

/** Content-derived, so identical bytes produce an identical tag — as a real cTag does. */
function tagOf(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex').slice(0, 16);
}
