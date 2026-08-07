import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The `core` schema (Phase 0 spec §3) — identity and relationships only, no business logic.
 * IDs are UUIDv7, generated in the app (time-ordered → index-friendly and sortable).
 */
export const core = pgSchema('core');

export const users = core.table('users', {
  id: uuid('id').primaryKey(),
  oidcSubject: text('oidc_subject').notNull().unique(), // Zitadel `sub` claim
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The entity registry — one identity for everything (Master §7).
 * INVARIANT: a module row and its registry entry share the same UUID and are written
 * in the SAME transaction. No entity exists without a registry entry.
 */
export const entities = core.table(
  'entities',
  {
    id: uuid('id').primaryKey(),
    entityType: text('entity_type').notNull(), // 'demo_item', later 'client', 'project', …
    owningModule: text('owning_module').notNull(),
    displayName: text('display_name').notNull(), // denormalized for cheap link rendering
    urlPath: text('url_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft delete
  },
  (t) => [index('entities_type_idx').on(t.entityType)],
);

/** Contextual links (Master §8.2) — any entity to any entity, permission-checked both ends. */
export const links = core.table(
  'links',
  {
    id: uuid('id').primaryKey(),
    fromType: text('from_type').notNull(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => entities.id),
    toType: text('to_type').notNull(),
    toId: uuid('to_id')
      .notNull()
      .references(() => entities.id),
    linkKind: text('link_kind'), // 'about' | 'discussed' | 'originated_from' | null
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('links_unique').on(t.fromId, t.toId, t.linkKind),
    index('links_from_idx').on(t.fromId),
    index('links_to_idx').on(t.toId),
  ],
);

/** Event outbox (Master §9). Payloads carry IDs and scalars ONLY — never full records. */
export const events = core.table('events', {
  id: uuid('id').primaryKey(),
  eventName: text('event_name').notNull(), // 'demo_item.created'
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  actorId: uuid('actor_id'), // null = system
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** At-least-once delivery tracked per subscriber; handlers must be idempotent. */
export const eventDeliveries = core.table(
  'event_deliveries',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    subscriber: text('subscriber').notNull(), // '<module>.<handlerName>'
    status: text('status').notNull().default('pending'), // pending | done | failed | dead
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.subscriber] }),
    index('event_deliveries_status_idx').on(t.status),
  ],
);

/** Every mutation on core entities is logged (Master §30 / audit principle). */
export const auditLog = core.table(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => users.id), // null = system/dispatcher
    action: text('action').notNull(), // 'demo_item.create', 'link.create', …
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    detail: jsonb('detail').notNull().default({}),
    aiInitiated: boolean('ai_initiated').notNull().default(false), // true when a tool call did this
    conversationId: uuid('conversation_id'), // future FK to the conversation store
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_entity_idx').on(t.entityId, t.createdAt)],
);

/** STUB — table only. The storage service arrives in Phase 3 (Document Management). */
export const files = core.table('files', {
  id: uuid('id').primaryKey(),
  storageKey: text('storage_key').notNull(), // S3 object key (Hetzner object storage)
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Conversation store (AI plan §3.4).
 *
 * Lives in `core` rather than a module because the assistant is a horizontal capability,
 * not module twelve — every module's tools run through the same conversations.
 */
/**
 * Somewhere to put conversations, once there are more than a screenful.
 *
 * Per user, because a conversation is per user — there is no sharing here and a folder that
 * outlived the only person who could see inside it would be a puzzle rather than a feature.
 */
export const conversationFolders = core.table(
  'conversation_folders',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /**
     * One level of nesting, enforced in the service rather than the schema.
     *
     * A self-reference cannot express "at most two deep" — that is a check on the whole
     * chain, not on a row — so the column allows any depth and `createFolder` refuses a
     * parent that already has one. Deeper trees are a filing system you get lost in.
     */
    parentId: uuid('parent_id'),
    /** Manual order. Alphabetical put the folder you use most wherever its name fell. */
    position: integer('position').notNull().default(0),
    /** A colour and a glyph, for finding a folder without reading it. */
    colour: text('colour'),
    emoji: text('emoji'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversation_folders_user_idx').on(t.userId, t.position),
    index('conversation_folders_parent_idx').on(t.parentId),
    check('conversation_folders_named', sql`length(trim(${t.name})) > 0`),
    check('conversation_folders_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

/**
 * Tags, because a folder makes you choose.
 *
 * A conversation about DocHorse invoicing belongs under the client and under billing, and a
 * single `folder_id` forces one. Folders stay for hierarchy — the drawer you put things in —
 * and tags cut across it.
 */
export const conversationTags = core.table(
  'conversation_tags',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    colour: text('colour'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversation_tags_unique').on(t.userId, t.name),
    check('conversation_tags_named', sql`length(trim(${t.name})) > 0`),
  ],
);

export const conversationTagLinks = core.table(
  'conversation_tag_links',
  {
    conversationId: uuid('conversation_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => conversationTags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.tagId] }),
    index('conversation_tag_links_tag_idx').on(t.tagId),
  ],
);

/**
 * A saved search that keeps itself current — a folder you never have to file into.
 *
 * The query is stored as the same shape the list endpoint already accepts, so a smart folder
 * is literally a remembered set of filters rather than a second query language.
 */
export const conversationViews = core.table(
  'conversation_views',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    query: jsonb('query').notNull().default({}),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversation_views_user_idx').on(t.userId, t.position),
    check('conversation_views_named', sql`length(trim(${t.name})) > 0`),
  ],
);

export const conversations = core.table(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    /**
     * Whether the title is still the one generated from the first question.
     *
     * Renaming sets this false, and auto-titling then leaves it alone. Without it, naming a
     * thread and asking one more question would silently rename it back.
     */
    titleIsAuto: boolean('title_is_auto').notNull().default(true),
    /** Null is the top level, which is where a conversation starts and most of them stay. */
    folderId: uuid('folder_id').references(() => conversationFolders.id, {
      onDelete: 'set null',
    }),
    /** Pinned to the top of the list, above the by-recency ordering. */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    /**
     * The record this conversation is about.
     *
     * A registry id, taken from the page the question was asked on. It was already being
     * sent — the orchestrator used it to write the system prompt and then discarded it — so a
     * chat started from a client's page had no lasting connection to that client. Storing it
     * files the conversation without anybody filing it.
     */
    subjectId: uuid('subject_id'),
    /** Out of the way, still searchable. Deleting was the only way to shorten the list. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userId, t.updatedAt),
    index('conversations_folder_idx').on(t.folderId),
    index('conversations_subject_idx').on(t.subjectId),
  ],
);

export const messages = core.table(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    /** Tool calls made while producing this message — the audit trail's human-readable half. */
    toolCalls: jsonb('tool_calls').notNull().default([]),
    /**
     * Records this message is about, resolved at the time it was written.
     *
     * Stored rather than recomputed so reopening a conversation still shows its cards
     * without replaying every tool call.
     */
    references: jsonb('references').notNull().default([]),
    /** Kept out of the thread it lives in — often the unit you want is one answer. */
    starredAt: timestamp('starred_at', { withTimezone: true }),
    /** Held at the top of its own conversation, for the answer a long thread keeps returning to. */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_starred_idx').on(t.starredAt),
  ],
);

/**
 * The organisation's own legal identity — what appears on every quote and invoice.
 *
 * A single row, in core: these values are not module data, they are who the platform
 * belongs to. Hard-coding them into a template is how a moved office ships on invoices
 * for a year.
 */
export const orgSettings = core.table('org_settings', {
  id: integer('id').primaryKey().default(1),
  legalName: text('legal_name').notNull().default(''),
  addressLine1: text('address_line1').notNull().default(''),
  addressLine2: text('address_line2').notNull().default(''),
  kvkNumber: text('kvk_number').notNull().default(''),
  vatNumber: text('vat_number').notNull().default(''),
  iban: text('iban').notNull().default(''),
  invoiceEmail: text('invoice_email').notNull().default(''),
  /** Prefix for invoice numbers; the year and counter are appended. */
  invoiceNumberPrefix: text('invoice_number_prefix').notNull().default(''),
  defaultPaymentTermsDays: integer('default_payment_terms_days').notNull().default(30),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A comment on any registry entity.
 *
 * In core rather than in scrum, because the registry already makes every entity addressable
 * and a discussion is not a scrum concept — a question about an invoice or a note on a
 * contract wants the same table. Tasks are simply the first subject.
 *
 * Deliberately NOT registered as a registry entity itself. A comment has no page of its own,
 * so it would need a urlPath that resolves to nothing — and `entities.urlPath` is followed
 * verbatim by the timeline, the link list and the assistant's citations. It points AT a
 * registry row instead of becoming one.
 *
 * Deliberately not on core.events either. An event is a fact about a domain change with a
 * declared name from a manifest; a comment is content, it is editable, and it has no
 * business being replayed to subscribers.
 */
export const comments = core.table(
  'comments',
  {
    id: uuid('id').primaryKey(),
    /** Denormalised alongside the id, exactly as links.fromType is, so a thread can be
     *  read and permission-checked without joining the registry. */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => entities.id),
    /** One level of replies. Threads deeper than that turn into an argument with itself. */
    parentId: uuid('parent_id'),
    body: text('body').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    /**
     * Soft-deleted, so a reply does not lose its parent and the thread keeps its shape.
     * The body is blanked on delete rather than kept — "deleted" should mean deleted.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comments_subject_idx').on(t.subjectId, t.createdAt),
    index('comments_author_idx').on(t.authorId),
    check('comments_body_present', sql`length(${t.body}) > 0 OR ${t.deletedAt} IS NOT NULL`),
  ],
);

/**
 * One person's dashboard.
 *
 * A single jsonb column rather than a row per placement, because the layout is only ever read
 * and written whole — you fetch the dashboard, you drag something, you save the dashboard.
 * Normalising it would buy the ability to query "who has the burn widget", which nobody has
 * ever needed, at the cost of an ordering column and a delete-and-reinsert on every drag.
 *
 * Keyed on the user, one row each. There is deliberately no shared or team dashboard: the
 * whole point is that a finance manager and a developer do not want the same front door, and
 * a shared layout is the thing that forces them to.
 *
 * The shape inside is `Array<{ id, widget, span, settings? }>`, validated by the service on
 * the way in. It is not validated by the database, and it should not be — the set of valid
 * widget keys lives in the frontend registry, changes when a module ships, and would make this
 * column's constraint a thing that needs a migration every time somebody adds a card.
 */
export const dashboards = core.table('dashboards', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  layout: jsonb('layout').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
