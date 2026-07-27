import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The demo module's own schema — THROWAWAY, deleted after gate G0.
 * It exists to be the reference implementation Phase 1 (CRM) copies.
 */
export const demo = pgSchema('demo');

export const items = demo.table('items', {
  // SAME uuid as core.entities.id — the registry id IS the row id
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  note: text('note'),
  // registry uuid of a core user — deliberately NOT a cross-schema FK, so modules stay droppable
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
