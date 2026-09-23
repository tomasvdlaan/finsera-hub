import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GraphClient } from '../graph/graph.client.js';
import type { DriveApi, DriveItem } from '../graph/graph.types.js';
import {
  DocumentStore,
  type DocumentRef,
  type FolderSpec,
  type PutResult,
  type RemoteMeta,
  type UnfiledItem,
} from './document-store.js';

/** Generated invoice and quote PDFs. Dutch, because the people browsing the library are. */
const OUTGOING_FOLDER = 'Uitgaand';

/** Everything filed against a client or one of its projects. */
const CLIENTS_FOLDER = 'Clients';

/** Templates and prospect quotes — real documents belonging to no client. */
const ORG_FOLDER = '_Algemeen';

/**
 * What the platform writes on a schedule, rather than what a person filed.
 *
 * A top-level bucket, and excluded from listUnfiled below. Without that exclusion the
 * monthly hours ledger would sit in the Unfiled screen forever, and the one screen whose
 * job is "adopt what somebody moved in" would be permanently full of our own output.
 */
export const EXPORTS_FOLDER = '_Exports';

/**
 * Documents in a SharePoint library (decision D8).
 *
 * One library on one site, granted to this application with `Sites.Selected`. Not a folder
 * inside the existing FinseraHub site: that grant scopes at SITE level, so a folder there
 * would have handed this credential write access to 05_HR and every client's bookkeeping.
 *
 * What this buys is the thing no amount of local storage could: a person opens the file in
 * Word Online, co-authors it, and SharePoint keeps the version history. What it costs is that
 * the file can now change without us — which is why every read here also returns the metadata
 * a screen needs to admit that what it indexed may no longer be what is there.
 */
@Injectable()
export class SharePointDocumentStore extends DocumentStore {
  readonly backend = 'sharepoint' as const;

  constructor(
    private readonly drive: DriveApi,
    private readonly graph: GraphClient,
  ) {
    super();
  }

  get available(): boolean {
    return this.graph.configured;
  }

  async put(input: { data: Buffer; filename: string; folder: FolderSpec }): Promise<PutResult> {
    const folderId = await this.drive.ensureFolder(segmentsFor(input.folder));
    const item = await this.drive.upload(folderId, input.filename, input.data);
    return this.resultFrom(item, input.data);
  }

  /**
   * New bytes on the same item, which is what makes a SharePoint version.
   *
   * If the pointer has gone — somebody moved the file out of the library between the last
   * check and this upload — the version is filed as a new item rather than lost. A failed
   * upload here would mean a person's work has nowhere to go, and that is a worse outcome
   * than a file that ends up beside where it used to be.
   */
  async putNewVersion(
    ref: DocumentRef,
    input: { data: Buffer; filename: string; folder: FolderSpec },
  ): Promise<PutResult> {
    if (ref.backend !== 'sharepoint') {
      // A local document gaining its first SharePoint version: file it fresh.
      return this.put(input);
    }

    const existing = await this.drive.stat(ref.itemId);
    if (!existing) return this.put(input);

    const item = await this.drive.replaceContent(ref.itemId, input.data);
    return this.resultFrom(item, input.data);
  }

  async read(ref: DocumentRef): Promise<Buffer> {
    const { itemId, versionId } = this.pointerOf(ref);
    return this.drive.download(itemId, versionId);
  }

  /**
   * Buffered, not streamed.
   *
   * Graph answers /content with a redirect to a pre-authenticated URL, and the one thing that
   * must never happen is that URL reaching a browser — it carries its own authorisation, so
   * in the portal it would hand the file to whoever saw it. Following it server-side and
   * returning bytes is the cost of that guarantee, and a document is not a video.
   */
  async stream(ref: DocumentRef): Promise<Buffer> {
    return this.read(ref);
  }

  async head(ref: DocumentRef): Promise<RemoteMeta | null> {
    const { itemId } = this.pointerOf(ref);
    const item = await this.drive.stat(itemId);
    return item ? metaFrom(item) : null;
  }

  /**
   * Where a person opens it.
   *
   * This URL works because of THEIR SharePoint permission, not ours: the browser session
   * authenticates as them. So a colleague without access to the library gets Microsoft's own
   * refusal rather than a file, which is correct, and is why the endpoint that hands this out
   * says who it is for rather than simply redirecting.
   */
  async editUrl(ref: DocumentRef): Promise<string | null> {
    const { itemId } = this.pointerOf(ref);
    const item = await this.drive.stat(itemId);
    return item?.webUrl ?? null;
  }

  /**
   * Everything in the library the platform has never heard of.
   *
   * This is how a file moved in by hand — or dropped in from Explorer or Teams — becomes a
   * document. It walks the whole library, so it is called by one screen on demand and never
   * per row.
   */
  async listUnfiled(known: Set<string>): Promise<UnfiledItem[]> {
    const driveId = await this.drive.driveId();
    const all = await this.drive.listAll();

    return all
      .filter((item) => !known.has(item.id))
      .filter((item) => !item.path.split('/').includes(EXPORTS_FOLDER))
      .map((item) => ({
        driveId,
        itemId: item.id,
        filename: item.name,
        path: item.path,
        sizeBytes: item.size,
        webUrl: item.webUrl,
        lastModifiedAt: new Date(item.lastModifiedAt),
        lastModifiedBy: item.lastModifiedBy,
      }));
  }

  private async resultFrom(item: DriveItem, data: Buffer): Promise<PutResult> {
    return {
      ref: { backend: 'sharepoint', driveId: await this.drive.driveId(), itemId: item.id },
      // The name SharePoint RETURNED. A collision is resolved by renaming, and storing the
      // name we asked for would mean the record and the library disagree from day one.
      filename: item.name,
      sizeBytes: item.size || data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
      remote: metaFrom(item),
    };
  }

  private pointerOf(ref: DocumentRef): { itemId: string; versionId?: string } {
    if (ref.backend !== 'sharepoint') {
      throw new Error(`SharePointDocumentStore was handed a ${ref.backend} ref`);
    }
    return { itemId: ref.itemId, ...(ref.versionId ? { versionId: ref.versionId } : {}) };
  }
}

/**
 * Where a document goes, as folder names a person would have chosen.
 *
 * Three buckets at the top, each a category: client work, things belonging to nobody, and
 * what the platform writes on a schedule. That shape is deliberately the one FinseraHub
 * already uses — grouped top-level folders rather than a flat pile — and it is why `Clients`
 * is a bucket rather than a wrapper around everything. A single folder containing the whole
 * library is a level of nesting that carries no information.
 *
 * Names are the client's and the project's, because people browse this. Nothing is ever
 * looked up by this path: the item id is the pointer, and it survives somebody reorganising
 * the folders by hand.
 */
export function segmentsFor(folder: FolderSpec): string[] {
  if (folder.bucket === 'exports') return [EXPORTS_FOLDER];
  if (folder.orgScope || !folder.clientName) return [ORG_FOLDER];
  if (folder.bucket === 'outgoing') {
    return [CLIENTS_FOLDER, folder.clientName, OUTGOING_FOLDER];
  }
  return folder.projectName
    ? [CLIENTS_FOLDER, folder.clientName, folder.projectName]
    : [CLIENTS_FOLDER, folder.clientName];
}

function metaFrom(item: DriveItem): RemoteMeta {
  return {
    cTag: item.cTag,
    eTag: item.eTag,
    webUrl: item.webUrl,
    path: item.path,
    name: item.name,
    size: item.size,
    lastModifiedAt: new Date(item.lastModifiedAt),
    lastModifiedBy: item.lastModifiedBy,
  };
}
