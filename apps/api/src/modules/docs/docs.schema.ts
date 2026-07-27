import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
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
      sql`${t.clientId} IS NOT NULL OR ${t.projectId} IS NOT NULL`,
    ),
  ],
);

/**
 * Every upload creates a version; nothing is overwritten.
 *
 * Overwriting is how the wrong contract gets sent with no way to prove what changed.
 */
export const versions = docs.table(
  'versions',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(), // sha256 — an identical re-upload is detectable
    /** Extracted text, when the format allows it. Null means "stored but not indexed". */
    extractedText: text('extracted_text'),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('versions_document_version').on(t.documentId, t.version),
    index('versions_document_idx').on(t.documentId),
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
