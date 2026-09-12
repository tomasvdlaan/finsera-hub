/**
 * Where a document's bytes are, and how to get at them (decision D8).
 *
 * Not a `StorageService` driver, deliberately. StorageService takes bytes and hands back an
 * opaque string, which is the right shape for a whiteboard thumbnail and the wrong shape for
 * a file a person opens in Word: a SharePoint file has an item id, a content tag, a web URL
 * and a version history of its own, and squeezing those into a string means either encoding
 * a tuple and parsing it back everywhere, or throwing away the fields that were the entire
 * reason for moving. So StorageService stays exactly as it is, serving the blobs that have no
 * "open this" story — whiteboard images, note images, portal logos — and documents get this.
 *
 * It lives in core rather than in the docs module because the portal reads document bytes
 * directly and may not import a module's internals. Core imports no modules, so the boundary
 * checker stays satisfied and there is still only one implementation of each backend.
 */
import type { Readable } from 'node:stream';

/**
 * Where one version's bytes live.
 *
 * A discriminated union rather than a string, because the two backends genuinely differ and
 * pretending otherwise is what a driver would have forced.
 */
export type DocumentRef =
  | { backend: 'local'; storageKey: string }
  | { backend: 'sharepoint'; driveId: string; itemId: string; versionId?: string };

/**
 * Where a document should be filed, in terms the caller has.
 *
 * The caller passes who it belongs to; the store decides what that means as a path. The docs
 * module never builds a SharePoint path, which is what keeps the folder convention a single
 * decision in a single place.
 */
export interface FolderSpec {
  clientName?: string | null;
  projectName?: string | null;
  /**
   * 'outgoing' is the subfolder generated invoice and quote PDFs go to. Without it a client
   * folder fills with factuur-2026-0114.pdf and stops being somewhere a person can look.
   *
   * 'exports' is for files the platform writes on a schedule rather than because somebody
   * uploaded something — the monthly hours ledger. They belong to no client, and they are
   * deliberately invisible to the Unfiled screen: that screen exists to adopt files a person
   * put there, and offering to file our own output every fifteen minutes would make it
   * useless.
   */
  bucket?: 'documents' | 'outgoing' | 'exports';
  /** Templates and prospect quotes: real documents that belong to no client. */
  orgScope?: boolean;
}

/** What the remote side says about a file, as of the moment we asked. */
export interface RemoteMeta {
  cTag: string;
  eTag: string;
  webUrl: string;
  path: string;
  name: string;
  size: number;
  lastModifiedAt: Date;
  lastModifiedBy: string | null;
}

export interface PutResult {
  ref: DocumentRef;
  /**
   * What the file is actually called now.
   *
   * SharePoint resolves a name collision by renaming, so the name it returns and the name we
   * asked for are not always the same — and the returned one is the true one.
   */
  filename: string;
  sizeBytes: number;
  /** sha256 of the bytes we sent. Ours, not the remote's: Graph's own hash is quickXorHash. */
  checksum: string;
  remote: RemoteMeta | null;
}

/** One file in the library that the platform has no document row for. */
export interface UnfiledItem {
  driveId: string;
  itemId: string;
  filename: string;
  path: string;
  sizeBytes: number;
  webUrl: string;
  lastModifiedAt: Date;
  lastModifiedBy: string | null;
}

/**
 * The abstract class is the DI token.
 *
 * Nest cannot inject a bare interface, and a string token loses the type. Extending this is
 * also what makes "did you implement all of it" a compile error rather than a runtime one.
 */
export abstract class DocumentStore {
  abstract readonly backend: 'local' | 'sharepoint';

  /** Whether files can actually be written right now. False is an ordinary state. */
  abstract readonly available: boolean;

  abstract put(input: {
    data: Buffer;
    filename: string;
    folder: FolderSpec;
  }): Promise<PutResult>;

  /**
   * New bytes for an existing file.
   *
   * On SharePoint this replaces the content of the same item, which is what creates a
   * SharePoint version and what keeps a link somebody pinned in Teams pointing at the current
   * file. On local disk there is no such thing, so it writes a new object and the caller's
   * own version row is the history — which is exactly what it was before D8.
   */
  abstract putNewVersion(
    ref: DocumentRef,
    input: { data: Buffer; filename: string; folder: FolderSpec },
  ): Promise<PutResult>;

  abstract read(ref: DocumentRef): Promise<Buffer>;

  /** Bytes without buffering them all, where the backend can. */
  abstract stream(ref: DocumentRef): Promise<Readable | Buffer>;

  /** Metadata only. Null means the file is gone — moved out of the library, or deleted. */
  abstract head(ref: DocumentRef): Promise<RemoteMeta | null>;

  /** Where a person would go to edit this. Null when the backend has no such place. */
  abstract editUrl(ref: DocumentRef): Promise<string | null>;

  /** Files in the library with no document row here. Empty for a backend without one. */
  abstract listUnfiled(known: Set<string>): Promise<UnfiledItem[]>;
}

/**
 * Build a ref from the columns a version row carries.
 *
 * One place, because three callers reconstruct this — the docs service, the portal's
 * download and the portal's preview proxy — and a fourth spelling of it is how one of them
 * quietly keeps reading the local disk after everything else has moved.
 */
export function refFromRow(row: {
  storageBackend?: string | null;
  storage_backend?: string | null;
  storageKey?: string | null;
  storage_key?: string | null;
  driveId?: string | null;
  drive_id?: string | null;
  driveItemId?: string | null;
  drive_item_id?: string | null;
  sharepointVersionId?: string | null;
  sharepoint_version_id?: string | null;
}): DocumentRef {
  const backend = row.storageBackend ?? row.storage_backend ?? 'local';
  if (backend === 'sharepoint') {
    const driveId = row.driveId ?? row.drive_id;
    const itemId = row.driveItemId ?? row.drive_item_id;
    if (!driveId || !itemId) {
      throw new Error('A SharePoint version row is missing its pointer');
    }
    const versionId = row.sharepointVersionId ?? row.sharepoint_version_id ?? undefined;
    return { backend: 'sharepoint', driveId, itemId, ...(versionId ? { versionId } : {}) };
  }

  const storageKey = row.storageKey ?? row.storage_key;
  if (!storageKey) throw new Error('A local version row is missing its storage key');
  return { backend: 'local', storageKey };
}

/** The columns a version row needs to select for `refFromRow` to work. Kept honest by a spec. */
export const REF_COLUMNS = [
  'storage_backend',
  'storage_key',
  'drive_id',
  'drive_item_id',
] as const;
