import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GraphClient } from './graph.client.js';
import type { DriveApi, DriveItem } from './graph.types.js';

/** Graph's simple-upload ceiling. Above this a session is required, not preferred. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

/** Chunk size for a session upload. Graph requires a multiple of 320 KiB; this is 8 MiB. */
const CHUNK_BYTES = 320 * 1024 * 25;

/**
 * The real Graph drive, bound to one site's document library.
 *
 * Everything Microsoft-shaped lives here: path encoding, upload sessions, the redirect on
 * /content, the difference between a 404 that means "make the folder" and a 404 that means
 * "somebody deleted this". Above this class there is only `DriveItem`.
 */
@Injectable()
export class GraphDriveService implements DriveApi {
  private readonly logger = new Logger(GraphDriveService.name);
  private cachedDriveId: string | null = null;

  constructor(private readonly graph: GraphClient) {}

  /**
   * The library's drive id, resolved once.
   *
   * Cached rather than configured, because a drive id is derivable from the site id and one
   * fewer environment variable is one fewer thing to get wrong in deploy/.env. GRAPH_DRIVE_ID
   * still wins when set, for the case where the site has more than one library.
   */
  async driveId(): Promise<string> {
    if (process.env.GRAPH_DRIVE_ID) return process.env.GRAPH_DRIVE_ID;
    if (this.cachedDriveId) return this.cachedDriveId;

    const drive = await this.graph.call<{ id: string }>(
      'GET',
      `/sites/${this.graph.siteId}/drive`,
    );
    this.cachedDriveId = drive.id;
    return drive.id;
  }

  /**
   * Walk the path, making what is missing.
   *
   * One segment at a time rather than one call, because Graph has no "create these four
   * folders" verb and because the interesting case is the partial one: the client folder
   * exists and the project folder under it does not.
   *
   * Idempotent under a race. Two uploads for a new client arrive together, both see no
   * folder, both create it; the loser gets a 409 and looks the folder up rather than failing,
   * because the folder it wanted now exists and that was the whole point.
   */
  async ensureFolder(segments: string[]): Promise<string> {
    const driveId = await this.driveId();
    const clean = segments.map(sanitiseSegment).filter(Boolean);

    let parentId = await this.rootId();
    const walked: string[] = [];

    for (const segment of clean) {
      walked.push(segment);

      const existing = await this.itemByPath(driveId, walked);
      if (existing) {
        parentId = existing.id;
        continue;
      }

      const res = await this.graph.raw('POST', `/drives/${driveId}/items/${parentId}/children`, {
        body: {
          name: segment,
          folder: {},
          // 'fail' rather than 'rename': a rename here would silently make a second folder
          // for the same client, which is worse than losing a race we know how to lose.
          '@microsoft.graph.conflictBehavior': 'fail',
        },
        tolerate: [409],
      });

      if (res.status === 409) {
        const found = await this.itemByPath(driveId, walked);
        if (!found) {
          throw new ServiceUnavailableException(
            `Graph reported "${segment}" already exists but will not return it`,
          );
        }
        parentId = found.id;
        continue;
      }

      parentId = ((await res.json()) as RawItem).id;
    }

    return parentId;
  }

  async upload(folderItemId: string, filename: string, data: Buffer): Promise<DriveItem> {
    const driveId = await this.driveId();
    const name = sanitiseSegment(filename);
    const target = `/drives/${driveId}/items/${folderItemId}:/${encodeURIComponent(name)}:`;

    if (data.byteLength <= SIMPLE_UPLOAD_LIMIT) {
      const item = await this.graph.call<RawItem>(
        'PUT',
        `${target}/content?@microsoft.graph.conflictBehavior=rename`,
        { body: data },
      );
      return toDriveItem(item);
    }

    const session = await this.graph.call<{ uploadUrl: string }>(
      'POST',
      `${target}/createUploadSession`,
      { body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } } },
    );
    return this.uploadChunks(session.uploadUrl, data);
  }

  /**
   * New bytes on the same item, which is what makes a SharePoint version.
   *
   * The alternative — a new item per version — would give every version its own id and its
   * own link, and a link somebody pinned in Teams would quietly stop being the current file.
   */
  async replaceContent(itemId: string, data: Buffer): Promise<DriveItem> {
    const driveId = await this.driveId();

    if (data.byteLength <= SIMPLE_UPLOAD_LIMIT) {
      const item = await this.graph.call<RawItem>(
        'PUT',
        `/drives/${driveId}/items/${itemId}/content`,
        { body: data },
      );
      return toDriveItem(item);
    }

    const session = await this.graph.call<{ uploadUrl: string }>(
      'POST',
      `/drives/${driveId}/items/${itemId}/createUploadSession`,
      { body: { item: { '@microsoft.graph.conflictBehavior': 'replace' } } },
    );
    return this.uploadChunks(session.uploadUrl, data);
  }

  /** Metadata only. Null means the item is gone — moved out of the library, or deleted. */
  async stat(itemId: string): Promise<DriveItem | null> {
    const driveId = await this.driveId();
    const res = await this.graph.raw('GET', `/drives/${driveId}/items/${itemId}`, {
      tolerate: [404],
    });
    if (res.status === 404) return null;
    return toDriveItem((await res.json()) as RawItem);
  }

  /**
   * The bytes, via the redirect Graph answers with.
   *
   * The Location is a short-lived PRE-AUTHENTICATED URL: it needs no bearer token, which is
   * exactly why it is followed here and never returned to anyone. Handing it to a browser
   * would mean handing out the file to whoever saw the URL, and in the portal that is a leak
   * of a document to someone who was never granted it.
   */
  async download(itemId: string, versionId?: string): Promise<Buffer> {
    const driveId = await this.driveId();
    const path = versionId
      ? `/drives/${driveId}/items/${itemId}/versions/${versionId}/content`
      : `/drives/${driveId}/items/${itemId}/content`;

    const res = await this.graph.raw('GET', path, { redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new ServiceUnavailableException('Graph redirected for content with no Location');
      }
      // Deliberately a bare fetch: this URL carries its own authorisation and Microsoft
      // rejects a bearer token on it.
      const bytes = await fetch(location);
      if (!bytes.ok) {
        throw new ServiceUnavailableException(`Graph content URL returned ${bytes.status}`);
      }
      return Buffer.from(await bytes.arrayBuffer());
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Every file under the root, flattened.
   *
   * Only the Unfiled view calls this, and only on a library the platform owns — so the
   * traversal is bounded by files a person deliberately put there, not by somebody's
   * accounting archive. It is still the most expensive thing here: paged, breadth-first,
   * and never called per row.
   */
  async listAll(): Promise<DriveItem[]> {
    const driveId = await this.driveId();
    const out: DriveItem[] = [];
    const queue: string[] = [await this.rootId()];

    while (queue.length > 0) {
      const parent = queue.shift() as string;
      let next: string | null = `/drives/${driveId}/items/${parent}/children?$top=200`;

      while (next) {
        const page: DriveChildren = await this.graph.call<DriveChildren>('GET', next);
        for (const raw of page.value) {
          const item = toDriveItem(raw);
          if (item.folder) queue.push(item.id);
          else out.push(item);
        }
        next = page['@odata.nextLink'] ?? null;
      }
    }

    return out;
  }

  /**
   * The folder everything hangs under.
   *
   * Created on first use like any other folder, so a fresh library needs no manual setup
   * beyond existing. Unset means the library root itself.
   */
  private async rootId(): Promise<string> {
    const driveId = await this.driveId();
    const configured = rootFolderName();
    if (!configured) {
      const item = await this.graph.call<RawItem>('GET', `/drives/${driveId}/root`);
      return item.id;
    }

    const existing = await this.itemByPath(driveId, []);
    if (existing) return existing.id;

    const libraryRoot = await this.graph.call<RawItem>('GET', `/drives/${driveId}/root`);
    const res = await this.graph.raw(
      'POST',
      `/drives/${driveId}/items/${libraryRoot.id}/children`,
      {
        body: {
          name: configured,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        },
        tolerate: [409],
      },
    );

    if (res.status === 409) {
      const found = await this.itemByPath(driveId, []);
      if (!found) {
        throw new ServiceUnavailableException('Could not resolve the configured root folder');
      }
      return found.id;
    }
    return ((await res.json()) as RawItem).id;
  }

  /**
   * Look an item up by path, under the configured root.
   *
   * Used only while ensuring folders. Nothing reads a file by path: an item id survives a
   * rename and a move in SharePoint's own UI, and a path does not.
   */
  private async itemByPath(driveId: string, segments: string[]): Promise<DriveItem | null> {
    const root = rootFolderName();
    const parts = [...(root ? [root] : []), ...segments].map(encodeURIComponent);
    if (parts.length === 0) {
      return toDriveItem(await this.graph.call<RawItem>('GET', `/drives/${driveId}/root`));
    }

    const res = await this.graph.raw('GET', `/drives/${driveId}/root:/${parts.join('/')}`, {
      tolerate: [404],
    });
    if (res.status === 404) return null;
    return toDriveItem((await res.json()) as RawItem);
  }

  /**
   * Push the bytes up a session, one range at a time.
   *
   * A bare fetch again, and for the same reason as `download`: an upload session URL is
   * pre-authenticated and Microsoft documents that an Authorization header must not be sent.
   *
   * A failed chunk resumes from what the server says it still wants — nextExpectedRanges —
   * rather than from where we thought we were, because those two disagree exactly when it
   * matters. A session we give up on is deleted: an abandoned one holds its name in the
   * folder, and the next attempt would be renamed around a file that does not exist.
   */
  private async uploadChunks(uploadUrl: string, data: Buffer): Promise<DriveItem> {
    const total = data.byteLength;
    let offset = 0;

    try {
      while (offset < total) {
        const end = Math.min(offset + CHUNK_BYTES, total);
        const chunk = data.subarray(offset, end);

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunk.byteLength),
            'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
          },
          body: new Uint8Array(chunk),
        });

        if (res.status === 200 || res.status === 201) {
          return toDriveItem((await res.json()) as RawItem);
        }

        if (res.status === 202) {
          const body = (await res.json()) as { nextExpectedRanges?: string[] };
          const resume = Number(body.nextExpectedRanges?.[0]?.split('-')[0]);
          offset = Number.isFinite(resume) ? resume : end;
          continue;
        }

        throw new ServiceUnavailableException(
          `Upload session refused a chunk (${res.status}): ${(await res.text()).slice(0, 400)}`,
        );
      }
    } catch (err) {
      await fetch(uploadUrl, { method: 'DELETE' }).catch(() => {
        this.logger.warn('Could not delete an abandoned upload session');
      });
      throw err;
    }

    throw new ServiceUnavailableException('Upload session ended without returning an item');
  }
}

function rootFolderName(): string {
  const raw = process.env.GRAPH_ROOT_FOLDER?.trim();
  return raw ? sanitiseSegment(raw) : '';
}

/**
 * Strip what SharePoint will not accept in a name.
 *
 * Done here rather than at the call sites because the call sites pass client and project
 * names, and a client is called whatever the client is called.
 */
export function sanitiseSegment(name: string): string {
  return name
    .replace(/[<>:"|?*\\/]/g, '-')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 240);
}

interface RawItem {
  id: string;
  name: string;
  size?: number;
  cTag?: string;
  eTag?: string;
  webUrl?: string;
  folder?: unknown;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { path?: string };
}

interface DriveChildren {
  value: RawItem[];
  '@odata.nextLink'?: string;
}

function toDriveItem(raw: RawItem): DriveItem {
  // Graph spells this two ways depending on the endpoint — '/drive/root:' and
  // '/drives/{driveId}/root:' — and this string exists only to tell a person where a file
  // lives, so a drive id in the middle of it defeats the entire purpose.
  const parent = (raw.parentReference?.path ?? '')
    .replace(/^\/drives\/[^/]+\/root:/, '')
    .replace(/^\/drive\/root:/, '');
  return {
    id: raw.id,
    name: raw.name,
    size: raw.size ?? 0,
    cTag: raw.cTag ?? '',
    eTag: raw.eTag ?? '',
    webUrl: raw.webUrl ?? '',
    path: `${parent}/${raw.name}`.replace(/^\/+/, ''),
    lastModifiedAt: raw.lastModifiedDateTime ?? new Date(0).toISOString(),
    lastModifiedBy: raw.lastModifiedBy?.user?.displayName ?? null,
    folder: raw.folder !== undefined,
  };
}
