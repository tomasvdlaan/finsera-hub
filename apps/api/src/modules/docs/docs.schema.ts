import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** pgvector column. Drizzle has no native type for it, so declare the mapping once. */
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value: number[]) => `[${value.join(',')}]`,
    fromDriver: (value: string) => JSON.parse(value) as number[],
  })(name);

/**
 * Vector width, declared literally rather than imported.
 *
 * The migration tool loads schema files in isolation, so a schema that imports across
 * the tree cannot be read — which is a fair constraint: a table definition should not
 * depend on application code. The value must match core's EMBEDDING_DIMENSIONS, and a
 * test asserts that so the two cannot drift apart silently.
 */
const EMBEDDING_DIMENSIONS = 768;

export const docs = pgSchema('docs');

/**
 * The thing people refer to — "the signed NDA". Stable identity, versioned content.
 */
export const documents = docs.table(
  'documents',
  {
    id: uuid('id').primaryKey(), // registry id
    title: text('title').notNull(),
    // A document with neither a client nor a project is unfindable; enforced below.
    clientId: uuid('client_id'),
    projectId: uuid('project_id'),
    category: text('category'), // free text — taxonomies calcify
    currentVersionId: uuid('current_version_id'),

    /**
     * A home that is not a client or a project.
     *
     * 'org' covers the two things that genuinely belong to nobody: the templates (a
     * raamovereenkomst, the algemene voorwaarden) and a quote written for a prospect, who
     * is by definition not yet a client. Both were unfileable while every document had to
     * name one — and the workaround, inventing a placeholder client, is how a CRM fills
     * with rows that are not companies.
     */
    scope: text('scope'),

    /* ── What a model read, as opposed to what somebody typed ──────────────────────────
     *
     * Kept apart from the descriptive columns above on purpose. `title` and `category` are
     * assertions by a person; everything here is derived, can be wrong, and can be regenerated.
     * A screen showing them should be able to say which is which.
     */

    /** One paragraph, written when the text is indexed — the pipeline already reads it all. */
    summary: text('summary'),
    summarisedAt: timestamp('summarised_at', { withTimezone: true }),

    /** The two extracted facts worth querying as columns rather than burying in jsonb. */
    docType: text('doc_type'),
    valueCents: bigint('value_cents', { mode: 'number' }),

    /** Payment terms, notice, dates, counterparty — shapes differ per kind of document. */
    terms: jsonb('terms'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    /**
     * Which version was read.
     *
     * Extraction is a claim about a *file*, not about a document — so a v2 upload must be able
     * to mark the old terms as describing something that is no longer on screen.
     */
    extractedVersionId: uuid('extracted_version_id'),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_client_idx').on(t.clientId),
    index('documents_project_idx').on(t.projectId),
    check(
      'documents_has_a_home',
      sql`${t.clientId} IS NOT NULL OR ${t.projectId} IS NOT NULL OR ${t.scope} = 'org'`,
    ),
  ],
);

/**
 * Every upload creates a version; nothing is overwritten.
 *
 * Overwriting is how the wrong contract gets sent with no way to prove what changed.
 *
 * Since D8 a row is no longer only "an upload". When the bytes live in SharePoint this
 * table stops being where they are and becomes THE SUBSET OF SHAREPOINT'S OWN HISTORY THE
 * PLATFORM HAS READ: SharePoint holds the live file and every version of it, and a row here
 * records what was read, when, and what can therefore be answered about it. The distance
 * between the two is exactly the staleness a screen has to show, because indexing is manual
 * and nobody is watching the file on our behalf.
 */
export const versions = docs.table(
  'versions',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),

    /* ── where the bytes are ────────────────────────────────────────────────────────── */

    /** 'local' or 'sharepoint'. Existing rows are local and stay local, forever if need be. */
    storageBackend: text('storage_backend').notNull().default('local'),
    /** Set for local rows only. Nullable since D8; the CHECK below keeps it honest. */
    storageKey: text('storage_key'),
    driveId: text('drive_id'),
    /**
     * The pointer.
     *
     * An item id survives a rename and a move inside the library, which is why nothing here
     * reads a file by path — a person reorganising folders in SharePoint must not be able to
     * break a document by tidying up.
     */
    driveItemId: text('drive_item_id'),
    /** Which of SharePoint's versions this row describes, so old bytes stay fetchable. */
    sharepointVersionId: text('sharepoint_version_id'),
    /**
     * The CONTENT tag, and the only thing staleness is judged on.
     *
     * eTag also moves when metadata moves, so comparing it would mark a document out of date
     * because somebody set a column — and under manual indexing it would stay that way until
     * a person re-read a file whose contents had not changed.
     */
    ctag: text('ctag'),
    etag: text('etag'),
    /** Snapshot of where it lives, for telling a person. Never used to find anything. */
    sharepointPath: text('sharepoint_path'),
    /** The "Open in Word" target. Never exposed to the portal — see docs.manifest. */
    webUrl: text('web_url'),

    /**
     * How this row came to exist: an upload here, a sync that noticed SharePoint had moved
     * on, or a file somebody put in the library that was later filed through the platform.
     * Worth distinguishing on screen: "v3, uploaded 4 Aug" and "v3, which is what SharePoint
     * already said on 4 Aug" are different claims.
     */
    origin: text('origin').notNull().default('upload'),

    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(), // sha256 — an identical re-upload is detectable
    /** Extracted text, when the format allows it. Null means "stored but not indexed". */
    extractedText: text('extracted_text'),

    /* ── what we know, and when we last knew it ──────────────────────────────────────── */

    /** When the text was last extracted, chunked and embedded. Null means never. */
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    /** driveItem.lastModifiedDateTime as of the last check. */
    remoteModifiedAt: timestamp('remote_modified_at', { withTimezone: true }),
    /**
     * Who changed it there.
     *
     * The app identity for anything we filed — honest, we did write it — but a real person
     * for a Word Online edit, because that edit went through their session and not ours. So
     * this is worth showing, and worth showing as a different fact from uploadedBy.
     */
    remoteModifiedBy: text('remote_modified_by'),
    /** When we last asked. Distinct from indexedAt: asking is cheap, reading is not. */
    remoteCheckedAt: timestamp('remote_checked_at', { withTimezone: true }),
    /**
     * When the file stopped being there.
     *
     * The row is never deleted for this. The record, its extracted text and its chunks are
     * still true and still answer questions; it is the file that is gone, and a screen can
     * say so far more usefully than a document that silently vanishes.
     */
    missingAt: timestamp('missing_at', { withTimezone: true }),

    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('versions_document_version').on(t.documentId, t.version),
    index('versions_document_idx').on(t.documentId),
    index('versions_drive_item_idx').on(t.driveItemId),
    /**
     * A row must actually say where its bytes are.
     *
     * Without this the nullable storage_key is an invitation: one code path that forgets to
     * set the pointer produces a version that looks fine in every list and cannot be
     * downloaded, and the day you find out is the day somebody needs the file.
     */
    check(
      'versions_knows_where_the_bytes_are',
      sql`(${t.storageBackend} = 'local' AND ${t.storageKey} IS NOT NULL)
          OR (${t.storageBackend} = 'sharepoint'
              AND ${t.driveId} IS NOT NULL AND ${t.driveItemId} IS NOT NULL)`,
    ),
  ],
);

/**
 * The knowledge layer (AI plan §3.3).
 *
 * Chunks belong to a VERSION, not a document: re-uploading replaces the content, so the
 * old version's chunks must not linger and answer questions about superseded text.
 */
export const chunks = docs.table(
  'chunks',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => versions.id, { onDelete: 'cascade' }),
    /** Denormalized so permission filtering never needs a join back through versions. */
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', EMBEDDING_DIMENSIONS),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chunks_version_idx').on(t.versionId),
    index('chunks_document_idx').on(t.documentId),
  ],
);
