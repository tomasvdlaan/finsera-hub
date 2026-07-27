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
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { CrmService } from '../crm/crm.service.js';
import { chunks, documents, versions } from './docs.schema.js';
import { chunkText } from './extract.js';

export interface UploadInput {
  filename: string;
  mimeType: string;
  data: Buffer;
  title?: string;
  clientId?: string;
  projectId?: string;
  category?: string;
}

export interface SearchHit {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  via: 'text' | 'semantic';
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
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingService,
    private readonly fileTypes: FileTypeRegistry,
    private readonly crm: CrmService,
  ) {}

  // ── upload and versioning ──────────────────────────────────

  async upload(actor: Actor, input: UploadInput) {
    await this.require(actor, 'docs.write');
    if (!input.clientId && !input.projectId) {
      throw new BadRequestException('A document needs a client or a project');
    }
    if (!input.data?.length) throw new BadRequestException('Empty file');

    // Both are cross-module reads through CRM's service, never its schema.
    if (input.clientId) await this.crm.getClient(actor, input.clientId);
    if (input.projectId) await this.crm.getProject(actor, input.projectId);

    const stored = await this.storage.put(input.data, input.filename);
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
        storageKey: stored.key,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        extractedText: extracted,
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
        detail: { filename: input.filename, sizeBytes: stored.sizeBytes },
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

    const stored = await this.storage.put(input.data, input.filename);
    const extracted = await this.fileTypes.extract(input.data, input.mimeType, input.filename);
    const versionId = this.registry.newId();
    const nextVersion = (latest?.version ?? 0) + 1;

    await this.db.transaction(async (tx) => {
      await tx.insert(versions).values({
        id: versionId,
        documentId,
        version: nextVersion,
        storageKey: stored.key,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        extractedText: extracted,
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
        detail: { version: nextVersion, filename: input.filename },
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

    return { ...doc, versions: history };
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

    return { version, data: await this.storage.get(version.storageKey) };
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
             ts_rank(to_tsvector('english', v.extracted_text), plainto_tsquery('english', ${q})) AS score
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
    const embedding = await this.embeddings.embedOne(query);
    const literal = `[${embedding.join(',')}]`;

    const result = await this.db.execute(sql`
      SELECT c.document_id, d.title, c.content,
             1 - (c.embedding <=> ${literal}::vector) AS score
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

    const embedding = await this.embeddings.embedOne(question);
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

    await this.db.delete(chunks).where(eq(chunks.versionId, versionId));

    const vectors = EmbeddingService.isConfigured()
      ? await this.embeddings.embedBatch(pieces.map((p) => p.content))
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
      SELECT d.id, d.title, d.category, d.client_id, d.project_id,
             v.version, v.filename, v.mime_type, v.size_bytes,
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
