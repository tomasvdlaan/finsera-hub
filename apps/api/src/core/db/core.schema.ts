import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const conversations = core.table(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);
