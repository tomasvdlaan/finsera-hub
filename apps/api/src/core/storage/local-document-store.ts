import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  DocumentStore,
  type DocumentRef,
  type FolderSpec,
  type PutResult,
  type RemoteMeta,
  type UnfiledItem,
} from './document-store.js';
import { StorageService } from './storage.service.js';

/**
 * Documents on the local disk — what every document was before D8, and what they stay.
 *
 * This is not a compatibility shim to be deleted later. Rows written before the migration
 * keep `storage_backend = 'local'` and keep working through here indefinitely; a Graph
 * failure while filing a generated invoice PDF falls back to here on purpose; and every test
 * runs through here so that nothing reaches Microsoft by accident.
 *
 * It is a thin wrapper over StorageService rather than a reimplementation, because the
 * sharding, the traversal guard and the backup script all already assume that layout.
 */
@Injectable()
export class LocalDocumentStore extends DocumentStore {
  readonly backend = 'local' as const;

  /** Disk is always there. If it is not, the process has larger problems than this method. */
  readonly available = true;

  constructor(private readonly storage: StorageService) {
    super();
  }

  /** The folder is ignored: a local key is a sharded UUID and has no place for a name. */
  async put(input: { data: Buffer; filename: string; folder: FolderSpec }): Promise<PutResult> {
    const stored = await this.storage.put(input.data, input.filename);
    return {
      ref: { backend: 'local', storageKey: stored.key },
      filename: input.filename,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      remote: null,
    };
  }

  /**
   * A new object, not a rewrite of the old one.
   *
   * Overwriting is how the wrong contract gets sent with no way to prove what changed — the
   * reason the versions table exists at all. The previous version's bytes stay exactly where
   * they were and stay downloadable.
   */
  async putNewVersion(
    _ref: DocumentRef,
    input: { data: Buffer; filename: string; folder: FolderSpec },
  ): Promise<PutResult> {
    return this.put(input);
  }

  async read(ref: DocumentRef): Promise<Buffer> {
    return this.storage.get(this.keyOf(ref));
  }

  async stream(ref: DocumentRef): Promise<Readable> {
    return this.storage.stream(this.keyOf(ref));
  }

  /**
   * Enough of a RemoteMeta to answer "is this still there", and no more.
   *
   * There is no remote here, so there is no cTag and no last-modified-by. A document on local
   * disk can never be stale against anything, which is the honest answer and the one the
   * staleness check in the docs module reads.
   */
  async head(ref: DocumentRef): Promise<RemoteMeta | null> {
    const key = this.keyOf(ref);
    if (!(await this.storage.exists(key))) return null;

    const data = await this.storage.get(key);
    return {
      cTag: createHash('sha256').update(data).digest('hex'),
      eTag: '',
      webUrl: '',
      path: key,
      name: key.split('/').pop() ?? key,
      size: data.byteLength,
      lastModifiedAt: new Date(0),
      lastModifiedBy: null,
    };
  }

  /** Nowhere to open it. The screen says so rather than offering a button that fails. */
  async editUrl(): Promise<string | null> {
    return null;
  }

  /**
   * Always empty.
   *
   * There is no library for somebody to drop a file into: a local key is generated here and
   * written here, so a file on this disk with no row is orphaned rather than unfiled, and
   * offering to adopt it would be offering to adopt our own litter.
   */
  async listUnfiled(): Promise<UnfiledItem[]> {
    return [];
  }

  private keyOf(ref: DocumentRef): string {
    if (ref.backend !== 'local') {
      throw new Error(`LocalDocumentStore was handed a ${ref.backend} ref`);
    }
    return ref.storageKey;
  }
}
