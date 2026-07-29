import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The client portal (Phase 7).
 *
 * One table, deliberately: everything a client sees is projected from the modules that
 * own it. The portal stores who may log in and which client they are — nothing else. A
 * portal that accumulated its own copy of projects and invoices would be a second source
 * of truth about a client's money, which is the last thing anyone needs.
 */
export const portal = pgSchema('portal');

export const portalUsers = portal.table(
  'users',
  {
    id: uuid('id').primaryKey(),

    /**
     * Which client this login is. Not a claim, not metadata on the identity provider —
     * a column, so "whose data is this?" is answered by a foreign key rather than by
     * trusting something a token said.
     */
    clientId: uuid('client_id').notNull(),

    /** The subject from the PORTAL Zitadel project. Never an internal subject. */
    oidcSubject: text('oidc_subject').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),

    /**
     * Revoking access is a column rather than a deletion, so the audit trail of what this
     * login saw survives the person leaving the client.
     */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),

    invitedBy: uuid('invited_by').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('portal_users_subject_unique').on(t.oidcSubject),
    // One login belongs to one client. A person who works for two clients gets two
    // logins, because merging them would mean a session that spans clients.
    index('portal_users_client_idx').on(t.clientId),
    uniqueIndex('portal_users_email_client').on(t.email, t.clientId),
    check('portal_users_email_present', sql`length(${t.email}) > 3`),
  ],
);
