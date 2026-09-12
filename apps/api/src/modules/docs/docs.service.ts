import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { EventBus } from '../../core/events/event-bus.service.js';
import { LinkService } from '../../core/links/link.service.js';
import { FileTypeRegistry } from '../../core/files/file-type.registry.js';
import type { Preview } from '../../core/files/file-type.js';
import { EmbeddingService } from '../../core/llm/embedding.service.js';
import { LlmService } from '../../core/llm/llm.service.js';
import { z } from 'zod';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { mimeFromKey } from '../../core/storage/storage-key.js';
import {
  DocumentStore,
  refFromRow,
  type FolderSpec,
  type PutResult,
} from '../../core/storage/document-store.js';
import { CrmService } from '../crm/crm.service.js';
import { chunks, documents, versions } from './docs.schema.js';
import { chunkText } from '../../core/text/chunk.js';

export interface UploadInput {
  filename: string;
  mimeType: string;
  data: Buffer;
  title?: string;
  clientId?: string;
  projectId?: string;
  category?: string;
  /**
   * Which subfolder of the client's this belongs in.
   *
   * Only billing and sales pass it, for the invoice and quote PDFs they archive. Without it
   * a client folder fills with factuur-2026-0114.pdf and stops being somewhere a person can
   * usefully look — the same instinct that produced Administratie/03. Maart/Kosten.
   */
  bucket?: 'documents' | 'outgoing';
}

export interface SearchHit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  via: 'text' | 'semantic';
  /**
   * Whether the file has changed since this text was read.
   *
   * On the HIT, not only on the detail page. This is the failure mode manual indexing
   * creates and the reason it is survivable: somebody searches, finds the old clause, and
   * without this has no reason at all to doubt it.
   */
  stale: boolean;
}

@Injectable()
export class DocsService {
  private readonly logger = new Logger(DocsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly registry: RegistryService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly links: LinkService,
    private readonly store: DocumentStore,
    private readonly embeddings: EmbeddingService,
    private readonly fileTypes: FileTypeRegistry,
    private readonly crm: CrmService,
    private readonly llm: LlmService,
  ) {}

  // ── upload and versioning ──────────────────────────────────

  async upload(actor: Actor, input: UploadInput) {
    await this.require(actor, 'docs.write');
    if (!input.clientId && !input.projectId) {
      throw new BadRequestException('A document needs a client or a project');
    }
    if (!input.data?.length) throw new BadRequestException('Empty file');

    // Both are cross-module reads through CRM's service, never its schema. Their names are
    // also what the file is filed under, so this read is no longer only a permission check.
    const client = input.clientId ? await this.crm.getClient(actor, input.clientId) : null;
    const project = input.projectId ? await this.crm.getProject(actor, input.projectId) : null;

    // Bytes land in the store BEFORE the transaction opens, so a failure there throws before
    // any row exists. There is never a version row pointing at a file that was never written.
    const stored = await this.store.put({
      data: input.data,
      filename: input.filename,
      folder: folderFor(client, project, input.bucket),
    });
    // Parsing a docx or pdf is real work; do it before opening the transaction.
    const extracted = await this.fileTypes.extract(input.data, input.mimeType, input.filename);
    const documentId = this.registry.newId();
    const versionId = this.registry.newId();
    const title = (input.title ?? input.filename).trim();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id: documentId,
        entityType: 'document',
        displayName: title,
        urlPath: `/docs/documents/${documentId}`,
      });

      await tx.insert(documents).values({
        id: documentId,
        title,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        category: input.category ?? null,
        currentVersionId: versionId,
        uploadedBy: actor.userId,
      });

      await tx.insert(versions).values({
        id: versionId,
        documentId,
        version: 1,
        ...pointerColumns(stored),
        // stored.filename, not input.filename: SharePoint resolves a name collision by
        // renaming, and the record and the library must not disagree from the first row.
        filename: stored.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        extractedText: extracted,
        origin: 'upload',
        uploadedBy: actor.userId,
      });

      // Mirror structural refs so documents appear on client/project timelines.
      for (const target of [input.clientId, input.projectId].filter(Boolean) as string[]) {
        await this.links.createWithin(tx, actor, {
          fromId: documentId,
          toId: target,
          kind: 'filed_under',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.upload',
        entityType: 'document',
        entityId: documentId,
        detail: {
          filename: stored.filename,
          sizeBytes: stored.sizeBytes,
          backend: stored.ref.backend,
        },
      });

      await this.events.publish(tx, {
        name: 'document.uploaded',
        entityType: 'document',
        entityId: documentId,
        actorId: actor.userId,
        payload: { clientId: input.clientId, projectId: input.projectId },
      });
    });

    // Indexing is deliberately outside the transaction: it calls an external API, and a
    // slow embedding provider must not hold a database transaction open.
    await this.indexVersion(versionId).catch((e) =>
      this.logger.warn(`Indexing failed for ${versionId}: ${(e as Error).message}`),
    );

    return this.getDocument(actor, documentId);
  }

  /** A new version of an existing document. The previous version stays downloadable. */
  async addVersion(actor: Actor, documentId: string, input: Omit<UploadInput, 'clientId' | 'projectId'>) {
    await this.require(actor, 'docs.write');
    const doc = await this.rawDocument(documentId);

    const [latest] = await this.db
      .select({ version: versions.version })
      .from(versions)
      .where(eq(versions.documentId, documentId))
      .orderBy(desc(versions.version))
      .limit(1);

    // Replace the content of the SAME remote file rather than adding another one: that is
    // what makes a SharePoint version, and what keeps a link somebody pinned in Teams
    // pointing at the current document instead of quietly at an old one.
    const current = await this.currentRefOf(documentId);
    const client = doc.clientId ? await this.crm.getClient(actor, doc.clientId) : null;
    const project = doc.projectId ? await this.crm.getProject(actor, doc.projectId) : null;
    const folder = folderFor(client, project);

    const stored = current
      ? await this.store.putNewVersion(current, {
          data: input.data,
          filename: input.filename,
          folder,
        })
      : await this.store.put({ data: input.data, filename: input.filename, folder });

    const extracted = await this.fileTypes.extract(input.data, input.mimeType, input.filename);
    const versionId = this.registry.newId();
    const nextVersion = (latest?.version ?? 0) + 1;

    await this.db.transaction(async (tx) => {
      await tx.insert(versions).values({
        id: versionId,
        documentId,
        version: nextVersion,
        ...pointerColumns(stored),
        filename: stored.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        extractedText: extracted,
        origin: 'upload',
        uploadedBy: actor.userId,
      });

      await tx
        .update(documents)
        .set({ currentVersionId: versionId, updatedAt: new Date() })
        .where(eq(documents.id, documentId));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.version_added',
        entityType: 'document',
        entityId: documentId,
        detail: { version: nextVersion, filename: stored.filename },
      });

      await this.events.publish(tx, {
        name: 'document.version_added',
        entityType: 'document',
        entityId: documentId,
        actorId: actor.userId,
        payload: { version: nextVersion },
      });
    });

    await this.indexVersion(versionId).catch((e) =>
      this.logger.warn(`Indexing failed for ${versionId}: ${(e as Error).message}`),
    );

    this.logger.log(`${doc.title}: version ${nextVersion}`);
    return this.getDocument(actor, documentId);
  }

  // ── reading ────────────────────────────────────────────────

  async listDocuments(
    actor: Actor,
    filter: { clientId?: string; projectId?: string; query?: string } = {},
  ) {
    await this.require(actor, 'docs.read');
    const where = [isNull(documents.archivedAt)];
    if (filter.clientId) where.push(eq(documents.clientId, filter.clientId));
    if (filter.projectId) where.push(eq(documents.projectId, filter.projectId));

    const rows = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        category: documents.category,
        clientId: documents.clientId,
        projectId: documents.projectId,
        updatedAt: documents.updatedAt,
        filename: versions.filename,
        mimeType: versions.mimeType,
        sizeBytes: versions.sizeBytes,
        version: versions.version,
        indexed: sql<boolean>`${versions.extractedText} IS NOT NULL`,
        // Both stamps, from stored columns only. The list must never call Graph per row:
        // two hundred documents would be two hundred requests and a throttle.
        indexedAt: versions.indexedAt,
        remoteModifiedAt: versions.remoteModifiedAt,
        // On the list as well as the detail: a folder of forty files called `scan_004.pdf` is
        // the case the summary exists for, and it cannot help there if you have to open each
        // one to see it.
        summary: documents.summary,
        docType: documents.docType,
        valueCents: documents.valueCents,
      })
      .from(documents)
      .leftJoin(versions, eq(versions.id, documents.currentVersionId))
      .where(and(...where))
      .orderBy(desc(documents.updatedAt))
      .limit(200);

    return filter.query
      ? rows.filter((r) => r.title.toLowerCase().includes(filter.query!.toLowerCase()))
      : rows;
  }

  async getDocument(actor: Actor, id: string) {
    await this.require(actor, 'docs.read');
    const doc = await this.rawDocument(id);
    const history = await this.db
      .select()
      .from(versions)
      .where(eq(versions.documentId, id))
      .orderBy(desc(versions.version));

    // Whether the client can see it, on the document rather than behind another request:
    // "shared" is a fact about a document, and a screen that has to ask separately is a
    // screen where the toggle and the truth can disagree for a moment.
    return {
      ...doc,
      versions: history,
      sharedWithClient: await this.sharedWithClient(id, doc.clientId),
    };
  }

  /**
   * Where the current version's bytes live, or null if there is no current version.
   *
   * Used when adding a version, to replace the content of the same remote file rather than
   * filing a second one beside it.
   */
  private async currentRefOf(documentId: string) {
    const [doc] = await this.db
      .select({ currentVersionId: documents.currentVersionId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!doc?.currentVersionId) return null;

    const [version] = await this.db
      .select()
      .from(versions)
      .where(eq(versions.id, doc.currentVersionId))
      .limit(1);
    return version ? refFromRow(version) : null;
  }

  /** Bytes for download. Defaults to the current version. */
  async download(actor: Actor, documentId: string, versionId?: string) {
    await this.require(actor, 'docs.read');
    const doc = await this.rawDocument(documentId);
    const targetId = versionId ?? doc.currentVersionId;

    const [version] = await this.db
      .select()
      .from(versions)
      .where(and(eq(versions.id, targetId!), eq(versions.documentId, documentId)))
      .limit(1);
    if (!version) throw new NotFoundException('Version not found');

    // refFromRow rather than version.storageKey: the row may point at SharePoint, and the
    // one thing that must not happen is a second spelling of "where are the bytes".
    return { version, data: await this.store.read(refFromRow(version)) };
  }

  async archive(actor: Actor, id: string) {
    await this.require(actor, 'docs.delete');
    await this.rawDocument(id);
    await this.db.transaction(async (tx) => {
      await tx.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, id));
      await this.registry.softDelete(tx, id);
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.archive',
        entityType: 'document',
        entityId: id,
      });
    });
  }


  // ── living with a file somebody else can change ────────────

  /**
   * Ask SharePoint whether the file has moved on. One metadata call, no bytes.
   *
   * This is what makes manual indexing honest. Nothing watches the file on our behalf — no
   * webhook, no delta poll, by decision — so the only way a screen can say "what you are
   * reading is out of date" is if somebody, at some point, asked. Asking is cheap; reading
   * and re-embedding is not, and this deliberately does neither.
   */
  async checkRemote(actor: Actor, documentId: string) {
    await this.require(actor, 'docs.read');
    const version = await this.currentVersionRow(documentId);

    if (version.storageBackend !== 'sharepoint') {
      // A local file cannot be stale against anything: nobody else can reach it.
      return { changed: false, missing: false, checkedAt: new Date(), supported: false };
    }

    const remote = await this.store.head(refFromRow(version));
    const now = new Date();

    if (!remote) {
      await this.db
        .update(versions)
        .set({ missingAt: version.missingAt ?? now, remoteCheckedAt: now })
        .where(eq(versions.id, version.id));
      return { changed: false, missing: true, checkedAt: now, supported: true };
    }

    await this.db
      .update(versions)
      .set({
        remoteModifiedAt: remote.lastModifiedAt,
        remoteModifiedBy: remote.lastModifiedBy,
        remoteCheckedAt: now,
        // Clear it: the file is back, or was never really gone.
        missingAt: null,
      })
      .where(eq(versions.id, version.id));

    return {
      // cTag, never eTag. eTag moves when a column changes, which would leave a document
      // permanently out of date because somebody tagged it.
      changed: remote.cTag !== version.ctag,
      missing: false,
      checkedAt: now,
      supported: true,
      remoteModifiedAt: remote.lastModifiedAt,
      remoteModifiedBy: remote.lastModifiedBy,
    };
  }

  /**
   * Re-read the file and catch the index up with it.
   *
   * When the content has genuinely changed this writes a new version row with origin
   * 'sync' — because it IS a new version, just one nobody uploaded here. The distinction
   * matters on screen: "v3, uploaded 4 Aug" and "v3, which is what SharePoint already said
   * on 4 Aug" are different claims about who did what.
   */
  async sync(actor: Actor, documentId: string) {
    await this.require(actor, 'docs.write');
    const doc = await this.rawDocument(documentId);
    const version = await this.currentVersionRow(documentId);
    const now = new Date();

    if (version.storageBackend !== 'sharepoint') {
      const chunkCount = await this.indexVersion(version.id);
      return { changed: false, missing: false, versionId: version.id, chunks: chunkCount };
    }

    const ref = refFromRow(version);
    const remote = await this.store.head(ref);

    if (!remote) {
      // The row survives, with its text and its chunks. Search keeps working from what we
      // already read, and the screen can say what happened — which is far more useful than
      // a document that silently stops existing.
      await this.db
        .update(versions)
        .set({ missingAt: version.missingAt ?? now, remoteCheckedAt: now })
        .where(eq(versions.id, version.id));
      return { changed: false, missing: true, versionId: version.id, chunks: 0 };
    }

    if (remote.cTag === version.ctag) {
      await this.db
        .update(versions)
        .set({
          remoteModifiedAt: remote.lastModifiedAt,
          remoteModifiedBy: remote.lastModifiedBy,
          remoteCheckedAt: now,
          missingAt: null,
        })
        .where(eq(versions.id, version.id));
      // Unchanged, but possibly never indexed — a file that failed to embed on upload gets
      // its second chance here rather than needing a different button.
      const chunkCount = version.indexedAt ? 0 : await this.indexVersion(version.id);
      return { changed: false, missing: false, versionId: version.id, chunks: chunkCount };
    }

    const data = await this.store.read(ref);
    const extracted = await this.fileTypes.extract(data, version.mimeType, remote.name);
    const versionId = this.registry.newId();

    await this.db.transaction(async (tx) => {
      await tx.insert(versions).values({
        id: versionId,
        documentId,
        version: version.version + 1,
        storageBackend: 'sharepoint',
        driveId: version.driveId,
        driveItemId: version.driveItemId,
        ctag: remote.cTag,
        etag: remote.eTag,
        sharepointPath: remote.path,
        webUrl: remote.webUrl,
        filename: remote.name,
        mimeType: version.mimeType,
        sizeBytes: remote.size,
        checksum: createHash('sha256').update(data).digest('hex'),
        extractedText: extracted,
        origin: 'sync',
        remoteModifiedAt: remote.lastModifiedAt,
        remoteModifiedBy: remote.lastModifiedBy,
        remoteCheckedAt: now,
        uploadedBy: actor.userId,
      });

      await tx
        .update(documents)
        .set({ currentVersionId: versionId, updatedAt: now })
        .where(eq(documents.id, documentId));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.synced',
        entityType: 'document',
        entityId: documentId,
        detail: { version: version.version + 1, changedBy: remote.lastModifiedBy },
      });

      await this.events.publish(tx, {
        name: 'document.synced',
        entityType: 'document',
        entityId: documentId,
        actorId: actor.userId,
        payload: { versionId, changedBy: remote.lastModifiedBy },
      });
    });

    const chunkCount = await this.indexVersion(versionId);
    this.logger.log(`${doc.title}: picked up SharePoint version ${version.version + 1}`);
    return { changed: true, missing: false, versionId, chunks: chunkCount };
  }

  /**
   * Where a person opens this to edit it.
   *
   * Gated on docs.write rather than docs.read, because this hands out an editing door — and
   * returned as JSON rather than a redirect, so the screen can explain that the door only
   * opens for somebody with their own SharePoint access. A redirect to a third-party URL is
   * also open-redirect-shaped, which is not a shape worth having.
   */
  async editUrl(actor: Actor, documentId: string) {
    await this.require(actor, 'docs.write');
    const version = await this.currentVersionRow(documentId);

    if (version.storageBackend !== 'sharepoint') {
      return {
        available: false,
        webUrl: null,
        reason: 'This document is stored on the platform, not in SharePoint.',
      };
    }

    const webUrl = await this.store.editUrl(refFromRow(version));
    if (!webUrl) {
      return { available: false, webUrl: null, reason: 'The file is no longer in SharePoint.' };
    }

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.edit_url_issued',
        entityType: 'document',
        entityId: documentId,
      });
    });

    return { available: true, webUrl, reason: null };
  }

  // ── files somebody put in the library by hand ──────────────

  /**
   * Everything in the library with no document row here.
   *
   * The way files moved in by hand become documents, and the way a file dropped in from
   * Explorer or Teams gets noticed later. Walks the whole library, so it is one screen on
   * demand and never anything per row.
   */
  async listUnfiled(actor: Actor) {
    await this.require(actor, 'docs.write');
    const rows = await this.db
      .select({ driveItemId: versions.driveItemId })
      .from(versions)
      .where(eq(versions.storageBackend, 'sharepoint'));

    const known = new Set(rows.map((r) => r.driveItemId).filter(Boolean) as string[]);
    return this.store.listUnfiled(known);
  }

  /**
   * Adopt one of them as a document.
   *
   * No bytes move: the file stays exactly where the person put it and the platform starts
   * pointing at it. That is the whole reason this exists rather than an import — a copy
   * would leave two files that drift, and the curation pass would have to be undone.
   */
  async fileUnfiled(
    actor: Actor,
    driveItemId: string,
    input: { title?: string; clientId?: string; projectId?: string; scope?: 'org'; mimeType?: string },
  ) {
    await this.require(actor, 'docs.write');
    if (!input.clientId && !input.projectId && input.scope !== 'org') {
      throw new BadRequestException('A document needs a client, a project, or org scope');
    }
    if (input.clientId) await this.crm.getClient(actor, input.clientId);
    if (input.projectId) await this.crm.getProject(actor, input.projectId);

    const candidates = await this.listUnfiled(actor);
    const item = candidates.find((c) => c.itemId === driveItemId);
    if (!item) throw new NotFoundException('No unfiled file with that id');

    const ref = { backend: 'sharepoint' as const, driveId: item.driveId, itemId: item.itemId };
    const data = await this.store.read(ref);
    const remote = await this.store.head(ref);
    const mimeType = input.mimeType ?? mimeFromKey(item.filename);
    const extracted = await this.fileTypes.extract(data, mimeType, item.filename);

    const documentId = this.registry.newId();
    const versionId = this.registry.newId();
    const title = (input.title ?? item.filename).trim();

    await this.db.transaction(async (tx) => {
      await this.registry.register(tx, {
        id: documentId,
        entityType: 'document',
        displayName: title,
        urlPath: `/docs/documents/${documentId}`,
      });

      await tx.insert(documents).values({
        id: documentId,
        title,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        scope: input.scope ?? null,
        currentVersionId: versionId,
        uploadedBy: actor.userId,
      });

      await tx.insert(versions).values({
        id: versionId,
        documentId,
        version: 1,
        storageBackend: 'sharepoint',
        driveId: item.driveId,
        driveItemId: item.itemId,
        ctag: remote?.cTag ?? null,
        etag: remote?.eTag ?? null,
        sharepointPath: item.path,
        webUrl: item.webUrl,
        filename: item.filename,
        mimeType,
        sizeBytes: item.sizeBytes,
        checksum: createHash('sha256').update(data).digest('hex'),
        extractedText: extracted,
        origin: 'adopted',
        remoteModifiedAt: item.lastModifiedAt,
        remoteModifiedBy: item.lastModifiedBy,
        remoteCheckedAt: new Date(),
        uploadedBy: actor.userId,
      });

      for (const target of [input.clientId, input.projectId].filter(Boolean) as string[]) {
        await this.links.createWithin(tx, actor, {
          fromId: documentId,
          toId: target,
          kind: 'filed_under',
        });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'document.filed',
        entityType: 'document',
        entityId: documentId,
        detail: { filename: item.filename, path: item.path },
      });

      await this.events.publish(tx, {
        name: 'document.uploaded',
        entityType: 'document',
        entityId: documentId,
        actorId: actor.userId,
        payload: { clientId: input.clientId, projectId: input.projectId },
      });
    });

    await this.indexVersion(versionId).catch((e) =>
      this.logger.warn(`Indexing failed for ${versionId}: ${(e as Error).message}`),
    );
    return this.getDocument(actor, documentId);
  }

  // ── letting a client see it ────────────────────────────────

  /**
   * Share this document with its client, or stop.
   *
   * The portal has enforced this since Phase 7 — a `shared_with_client` link, checked in SQL
   * — but nothing ever created one, so the feature was reachable only from a test. This is
   * that missing half.
   *
   * Deliberately NOT a SharePoint sharing link. A client holding a sharepoint.com URL would
   * bypass the per-person visibility grants entirely and hold a door into a library
   * containing every other client's documents. The bytes keep going through the portal, as
   * they always did.
   */
  async setSharedWithClient(actor: Actor, documentId: string, shared: boolean) {
    await this.require(actor, 'docs.write');
    const doc = await this.rawDocument(documentId);
    if (!doc.clientId) {
      throw new BadRequestException('This document is not filed under a client');
    }

    const existing = await this.shareLink(documentId, doc.clientId);

    if (shared && !existing) {
      await this.links.create(actor, {
        fromId: documentId,
        toId: doc.clientId,
        kind: 'shared_with_client',
      });
    } else if (!shared && existing) {
      await this.links.remove(actor, existing.id);
    }

    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: actor.userId,
        // Audited both ways: this is the action that makes a file leave the building.
        action: shared ? 'document.shared_with_client' : 'document.unshared_with_client',
        entityType: 'document',
        entityId: documentId,
        detail: { clientId: doc.clientId },
      });
    });

    return { shared };
  }

  /** Whether the client can currently see it. */
  async sharedWithClient(documentId: string, clientId: string | null): Promise<boolean> {
    if (!clientId) return false;
    return Boolean(await this.shareLink(documentId, clientId));
  }

  /**
   * The link that makes a document visible to its client, if it exists.
   *
   * Read through core's own link service rather than by querying core.links here — a module
   * touches only its own schema, and this is exactly the shortcut the ground rules name.
   */
  private async shareLink(documentId: string, clientId: string) {
    const all = await this.links.rawLinksFor([documentId]);
    return (
      all.find(
        (l) =>
          l.linkKind === 'shared_with_client' && l.fromId === documentId && l.toId === clientId,
      ) ?? null
    );
  }

  /** The current version row, or a clear failure. Every method above needs exactly this. */
  private async currentVersionRow(documentId: string) {
    const doc = await this.rawDocument(documentId);
    if (!doc.currentVersionId) throw new NotFoundException('Document has no version');

    const [version] = await this.db
      .select()
      .from(versions)
      .where(eq(versions.id, doc.currentVersionId))
      .limit(1);
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  // ── search ─────────────────────────────────────────────────

  /**
   * Full-text first, then semantic (AI plan §3.3 orders them this way).
   *
   * Full-text is cheaper, exact, and correct for the many searches that are really
   * keyword lookups. Semantic earns its cost on questions of meaning, where the words in
   * the question are not the words in the document.
   */
  async search(actor: Actor, query: string, limit = 10): Promise<SearchHit[]> {
    await this.require(actor, 'docs.read');
    const q = query?.trim();
    if (!q) return [];

    const textHits = await this.db.execute(sql`
      SELECT d.id AS document_id, d.title,
             ts_headline('english', v.extracted_text, plainto_tsquery('english', ${q}),
                         'MaxFragments=1,MaxWords=40,MinWords=15') AS snippet,
             ts_rank(to_tsvector('english', v.extracted_text), plainto_tsquery('english', ${q})) AS score,
             (v.remote_modified_at IS NOT NULL AND v.indexed_at IS NOT NULL
              AND v.remote_modified_at > v.indexed_at) AS stale
        FROM docs.documents d
        JOIN docs.versions v ON v.id = d.current_version_id
       WHERE d.archived_at IS NULL
         AND v.extracted_text IS NOT NULL
         AND to_tsvector('english', v.extracted_text) @@ plainto_tsquery('english', ${q})
       ORDER BY score DESC
       LIMIT ${limit}
    `);

    const hits: SearchHit[] = (textHits.rows as Record<string, unknown>[]).map((r) => ({
      documentId: r.document_id as string,
      title: r.title as string,
      snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').trim(),
      score: Number(r.score),
      via: 'text' as const,
      stale: r.stale === true,
    }));

    if (EmbeddingService.isConfigured()) {
      try {
        const semantic = await this.semanticSearch(q, limit);
        for (const hit of semantic) {
          if (!hits.some((h) => h.documentId === hit.documentId)) hits.push(hit);
        }
      } catch (e) {
        // Degrade to keyword-only rather than failing the search. An embedding provider
        // being down should cost relevance, not the whole feature.
        this.logger.warn(`Semantic search unavailable: ${(e as Error).message}`);
      }
    }

    return hits.slice(0, limit);
  }

  private async semanticSearch(query: string, limit: number): Promise<SearchHit[]> {
    const embedding = await this.embeddings.embedOne(query, { module: 'docs', feature: 'search' });
    const literal = `[${embedding.join(',')}]`;

    const result = await this.db.execute(sql`
      SELECT c.document_id, d.title, c.content,
             1 - (c.embedding <=> ${literal}::vector) AS score,
             (v.remote_modified_at IS NOT NULL AND v.indexed_at IS NOT NULL
              AND v.remote_modified_at > v.indexed_at) AS stale
        FROM docs.chunks c
        JOIN docs.documents d ON d.id = c.document_id
        JOIN docs.versions v ON v.id = d.current_version_id AND v.id = c.version_id
       WHERE d.archived_at IS NULL
       ORDER BY c.embedding <=> ${literal}::vector
       LIMIT ${limit}
    `);

    return (result.rows as Record<string, unknown>[]).map((r) => ({
      documentId: r.document_id as string,
      title: r.title as string,
      snippet: String(r.content).slice(0, 300),
      score: Number(r.score),
      via: 'semantic' as const,
      stale: r.stale === true,
    }));
  }

  /**
   * Answer a question from one document's own text.
   *
   * Returns passages, not prose — the assistant composes the answer, so this stays a
   * retrieval tool. Document text is untrusted input (AI plan §6): it is returned as
   * data for the orchestrator to delimit, never as instructions.
   */
  async askDocument(actor: Actor, documentId: string, question: string) {
    await this.require(actor, 'docs.read');
    const doc = await this.rawDocument(documentId);

    if (!EmbeddingService.isConfigured()) {
      const [current] = await this.db
        .select({ text: versions.extractedText })
        .from(versions)
        .where(eq(versions.id, doc.currentVersionId!))
        .limit(1);
      return { title: doc.title, passages: current?.text ? [current.text.slice(0, 4000)] : [] };
    }

    const embedding = await this.embeddings.embedOne(question, { module: 'docs', feature: 'ask' });
    const literal = `[${embedding.join(',')}]`;
    const result = await this.db.execute(sql`
      SELECT c.content
        FROM docs.chunks c
       WHERE c.document_id = ${documentId}
       ORDER BY c.embedding <=> ${literal}::vector
       LIMIT 5
    `);

    return {
      title: doc.title,
      passages: (result.rows as Record<string, unknown>[]).map((r) => String(r.content)),
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * WHAT THE DOCUMENT SAYS
   *
   * Two derived things, kept apart from the descriptive columns because they can be wrong and
   * can be regenerated. Any screen showing them should be able to say which is which.
   * ══════════════════════════════════════════════════════════════════════════ */

  /**
   * A paragraph, written once when the text is indexed.
   *
   * On the indexing path rather than on demand because the pipeline has already read every
   * word to chunk it — the text is in memory, the cost is one extra call, and a summary that
   * only appears when somebody asks is a summary nobody sees. A folder of forty files named
   * `scan_004.pdf` is the case this exists for.
   *
   * Never throws. A document whose summary failed is a document with no summary, which is
   * exactly what it was a moment earlier; letting this bubble would fail the upload.
   */
  private async summarise(documentId: string, text: string): Promise<void> {
    if (!LlmService.hasCredentials() || text.trim().length < 200) return;
    try {
      const { object } = await this.llm.generateStructured({
        context: { module: 'docs', feature: 'understand' },
        schema: z.object({
          summary: z
            .string()
            .describe('Two or three sentences on what this document is and what it commits anyone to.'),
        }),
        system:
          'You summarise business documents for a Dutch BI consultancy. Be specific about ' +
          'amounts, parties and dates when the document states them, and say nothing the ' +
          'document does not. Never guess a figure. Write in English whatever the source language.',
        // Truncated: the opening of a document carries what it is, and a hundred-page annex
        // costs tokens without changing the answer.
        messages: [{ role: 'user', content: text.slice(0, 12_000) }],
      });
      await this.db
        .update(documents)
        .set({ summary: object.summary, summarisedAt: new Date() })
        .where(eq(documents.id, documentId));
    } catch (e) {
      this.logger.warn(`Could not summarise ${documentId}: ${(e as Error).message}`);
    }
  }

  /**
   * Type, value and terms, pulled out on request.
   *
   * On demand rather than automatic, unlike the summary, because this is the half that can be
   * confidently wrong. A summary that misreads a document is vague; a *value* that misreads one
   * is a number somebody may repeat to a client. Making it an action means a person asked for
   * it and is looking at the answer when it arrives.
   *
   * Every field is nullable and the model is told to leave anything it cannot find empty. Null
   * here means "not stated", which is a real answer about a document.
   */
  async extractTerms(actor: Actor, documentId: string) {
    await this.require(actor, 'docs.write');
    const doc = await this.rawDocument(documentId);
    if (!LlmService.hasCredentials()) {
      throw new BadRequestException('No model is configured, so nothing can be extracted');
    }

    const [current] = await this.db
      .select({ id: versions.id, text: versions.extractedText })
      .from(versions)
      .where(eq(versions.id, doc.currentVersionId!))
      .limit(1);
    if (!current?.text?.trim()) {
      throw new BadRequestException('No text could be read from this file, so there is nothing to extract');
    }

    const { object } = await this.llm.generateStructured({
      context: { module: 'docs', feature: 'classify' },
      schema: z.object({
        docType: z
          .string()
          .nullable()
          .describe('quote, invoice, contract, report, letter, or another short lower-case noun'),
        valueCents: z
          .number()
          .int()
          .nullable()
          .describe('The headline total in cents, excluding VAT. Null unless the document states a total.'),
        currency: z.string().nullable().describe('ISO code, e.g. EUR'),
        counterparty: z.string().nullable().describe('The other party named in the document'),
        startsOn: z.string().nullable().describe('ISO date, or null'),
        endsOn: z.string().nullable().describe('ISO date, or null'),
        paymentTermDays: z.number().int().nullable(),
        noticeDays: z.number().int().nullable(),
      }),
      system:
        'You extract terms from business documents. Leave a field null unless the document ' +
        'states it plainly — a plausible guess is worse than an empty field here, because ' +
        'somebody will repeat these numbers to a client. Amounts are in cents, excluding VAT.',
      messages: [{ role: 'user', content: current.text.slice(0, 20_000) }],
    });

    const { docType, valueCents, ...terms } = object;
    const [row] = await this.db
      .update(documents)
      .set({
        docType,
        valueCents,
        terms,
        extractedAt: new Date(),
        // Stamped with the version that was read, so a v2 upload can mark these as describing
        // a file that is no longer on screen.
        extractedVersionId: current.id,
      })
      .where(eq(documents.id, documentId))
      .returning();

    await this.db.transaction((tx) =>
      this.audit.record(tx, {
        actorId: actor.userId ?? null,
        action: 'docs.terms.extracted',
        entityType: 'document',
        entityId: documentId,
        detail: { docType, valueCents },
      }),
    );
    return row;
  }

  // ── indexing ───────────────────────────────────────────────

  /** Chunk and embed a version. Replaces any existing chunks for that version. */
  async indexVersion(versionId: string): Promise<number> {
    const [version] = await this.db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);
    if (!version?.extractedText) return 0;

    const pieces = chunkText(version.extractedText);
    if (pieces.length === 0) return 0;

    // Fire-and-forget: a summary is worth having and is never worth failing an upload for.
    void this.summarise(version.documentId, version.extractedText);

    await this.db.delete(chunks).where(eq(chunks.versionId, versionId));

    const vectors = EmbeddingService.isConfigured()
      ? await this.embeddings.embedBatch(pieces.map((p) => p.content), { module: 'docs', feature: 'index' })
      : [];

    await this.db.insert(chunks).values(
      pieces.map((piece, i) => ({
        id: this.registry.newId(),
        versionId,
        documentId: version.documentId,
        ordinal: piece.ordinal,
        content: piece.content,
        embedding: vectors[i] ?? null,
      })),
    );

    // The stamp staleness is measured against. Without it "indexed" is a boolean and the
    // only question a screen can answer is whether we ever read the file, not whether what
    // we read is still what is there.
    await this.db
      .update(versions)
      .set({ indexedAt: new Date() })
      .where(eq(versions.id, versionId));

    this.logger.log(`Indexed ${pieces.length} chunk(s) for version ${version.version}`);
    return pieces.length;
  }

  /**
   * Re-embed a document's current version.
   *
   * Needed because changing the embedding model invalidates every stored vector — the
   * brief names this as a standing risk, so recovering from it is a supported operation
   * rather than a manual database fix.
   */
  async reindex(actor: Actor, documentId: string) {
    await this.require(actor, 'docs.write');
    const doc = await this.rawDocument(documentId);
    if (!doc.currentVersionId) return { chunks: 0 };
    return { chunks: await this.indexVersion(doc.currentVersionId) };
  }

  // ── AI tool handlers ───────────────────────────────────────

  async searchTool(actor: Actor, input: { query: string; limit?: number }) {
    const hits = await this.search(actor, input.query, input.limit ?? 5);
    return { results: hits };
  }

  async listTool(actor: Actor, input: { clientId?: string; projectId?: string }) {
    const rows = await this.listDocuments(actor, input);
    return {
      documents: rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        indexed: r.indexed,
      })),
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async rawDocument(id: string) {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async ensureReportingViews(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS docs.v_documents CASCADE`);
    await this.db.execute(sql`
      CREATE VIEW docs.v_documents AS
      SELECT d.id, d.title, d.category, d.client_id, d.project_id, d.scope,
             v.version, v.filename, v.mime_type, v.size_bytes,
             v.storage_backend, v.storage_key, v.drive_id, v.drive_item_id,
             v.indexed_at, v.remote_modified_at, v.missing_at,
             (v.extracted_text IS NOT NULL) AS indexed,
             d.uploaded_by, d.created_at, d.updated_at
        FROM docs.documents d
        LEFT JOIN docs.versions v ON v.id = d.current_version_id
       WHERE d.archived_at IS NULL
    `);
  }

  /** Full-text index, created here because drizzle cannot express a GIN expression index. */
  async ensureSearchIndexes(): Promise<void> {
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS versions_fts_idx
        ON docs.versions
     USING GIN (to_tsvector('english', coalesce(extracted_text, '')))
    `);
  }

  /**
   * A preview of a version, rendered by whichever file-type handler owns the format.
   * Binary kinds (image, pdf) tell the caller to fetch the bytes instead.
   */
  async previewVersion(actor: Actor, documentId: string, versionId?: string): Promise<Preview> {
    const { version, data } = await this.download(actor, documentId, versionId);
    return this.fileTypes.preview(data, version.mimeType, version.filename);
  }
}

/**
 * The columns that say where a version's bytes are.
 *
 * One function, because three insert sites write them and a fourth spelling is how a row
 * ends up looking fine in every list and refusing to download.
 */
function pointerColumns(stored: PutResult) {
  const ref = stored.ref;
  if (ref.backend === 'local') {
    return { storageBackend: 'local' as const, storageKey: ref.storageKey };
  }
  return {
    storageBackend: 'sharepoint' as const,
    driveId: ref.driveId,
    driveItemId: ref.itemId,
    ctag: stored.remote?.cTag ?? null,
    etag: stored.remote?.eTag ?? null,
    sharepointPath: stored.remote?.path ?? null,
    webUrl: stored.remote?.webUrl ?? null,
    remoteModifiedAt: stored.remote?.lastModifiedAt ?? null,
    remoteModifiedBy: stored.remote?.lastModifiedBy ?? null,
    remoteCheckedAt: new Date(),
  };
}

/**
 * Where a document belongs, in the store's terms.
 *
 * A document with neither a client nor a project is org-level — a template, or a quote for
 * somebody who is not a client yet — and those were unfileable before D8.
 */
function folderFor(
  client: { name?: string | null } | null,
  project: { name?: string | null } | null,
  bucket?: 'documents' | 'outgoing',
): FolderSpec {
  if (!client && !project) return { orgScope: true };
  return {
    clientName: client?.name ?? null,
    projectName: project?.name ?? null,
    ...(bucket ? { bucket } : {}),
  };
}
