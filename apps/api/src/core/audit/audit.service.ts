import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database, type Tx } from '../db/db.module.js';
import { auditLog, entities, users } from '../db/core.schema.js';

export interface AuditInput {
  actorId?: string | null; // null = system (e.g. the event dispatcher)
  action: string; //         'demo_item.create', 'link.create', …
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
  /** True when an AI tool call produced this mutation (AI plan §2). */
  aiInitiated?: boolean;
  conversationId?: string;
}

/**
 * Audit log — every mutation on core entities is recorded (Master §30).
 *
 * Takes a Tx on purpose: the audit entry commits with the change it describes, so the
 * log cannot drift from reality. "Who created this quote?" must always have an answer,
 * including when the answer is "the assistant, confirmed by Tomas".
 */
/** One "somebody was here" line, ready to render. */
export interface SignIn {
  at: string;
  /** The colleague, when it was one of ours. */
  userId: string | null;
  displayName: string | null;
  /** How they got in: the internal platform, or a client's portal. */
  surface: 'platform' | 'portal';
  /** Whose portal, for a portal sign-in. */
  clientName: string | null;
  /** Who it was when the platform has no user row for them — a client's own login. */
  label: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Who has been here, and when.
   *
   * The first thing in the platform to read this table back. Everything writes to it —
   * every mutation, every portal read — and until now nothing had a route, a query or a
   * page, so a log kept faithfully since Phase 0 could only be reached with `psql`.
   *
   * Sign-ins are read from here rather than from `core.events` because they have no subject
   * the event log will accept: an event needs a registry entity, and the core owns none —
   * a person is not an entity in this platform. Sitting in the audit log is not a
   * compromise, either. "Who was here" is exactly what an audit log is for.
   */
  async signIns(input: { userId?: string; since?: string; limit?: number } = {}): Promise<SignIn[]> {
    const conditions = [inArray(auditLog.action, ['core.signed_in', 'portal.login'])];
    if (input.userId) conditions.push(eq(auditLog.actorId, input.userId));
    if (input.since) conditions.push(gte(auditLog.createdAt, new Date(input.since)));

    const rows = await this.db
      .select({
        at: auditLog.createdAt,
        action: auditLog.action,
        actorId: auditLog.actorId,
        detail: auditLog.detail,
        displayName: users.displayName,
        // The subject of a portal sign-in is the client, and its display name is already
        // denormalised onto the registry row — no module table is touched to read it.
        clientName: entities.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(entities, eq(entities.id, auditLog.entityId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(input.limit ?? 50, 200));

    return rows.map((r) => {
      const detail = (r.detail ?? {}) as { portalUserId?: unknown; staff?: unknown };
      const portal = r.action === 'portal.login';
      return {
        at: r.at.toISOString(),
        userId: r.actorId,
        displayName: r.displayName,
        surface: portal ? ('portal' as const) : ('platform' as const),
        clientName: portal ? r.clientName : null,
        // A client's own sign-in has no user row behind it, so the row names them instead.
        label: portal && !r.actorId ? labelOf(detail) : null,
      };
    });
  }

  async record(tx: Tx, input: AuditInput): Promise<void> {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      detail: input.detail ?? {},
      aiInitiated: input.aiInitiated ?? false,
      conversationId: input.conversationId ?? null,
    });
  }
}

/**
 * The name a portal sign-in row carries for the person, when it was the client themselves.
 *
 * Stored under `email` because that is what the invitation knew about them; treated as
 * display text and nothing else — nothing joins on it or checks a permission with it.
 */
function labelOf(detail: Record<string, unknown>): string | null {
  const email = (detail as { email?: unknown }).email;
  return typeof email === 'string' && email.length > 0 && email.length <= 200 ? email : null;
}
