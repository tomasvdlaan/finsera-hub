import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from '../../core/db/core.schema.js';
import { DB, type Database, type Tx } from '../../core/db/db.module.js';
import { portalHandoffTickets, portalSessions, portalUsers } from './portal.schema.js';

/** Thirty days, then sign in again whatever happens. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Twelve hours without a request, and the session is over. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
/** How often `last_seen_at` is actually written. A write per request would be a write per asset. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;
/** Long enough for two redirects; short enough that a leaked URL is stale before it is read. */
export const TICKET_MS = 60 * 1000;

/** Who a session belongs to. Exactly one of the ids is set, and the database checks that. */
export interface SessionOwner {
  kind: 'client' | 'staff';
  portalUserId?: string;
  staffUserId?: string;
  clientId: string;
}

/** A live session, as the guard needs it. */
export interface ResolvedSession {
  id: string;
  kind: 'client' | 'staff';
  portalUserId: string | null;
  staffUserId: string | null;
  clientId: string;
  /**
   * From `portal.users` or `core.users` — re-read every time, so that disabling either
   * kind of account ends its sessions on the next request rather than whenever somebody
   * remembers to revoke them.
   */
  email: string | null;
}

/**
 * Sessions and handoff tickets — the two secrets the portal hands a browser (P1, P2).
 *
 * Both are random and both are stored hashed. A session secret is the cookie; a ticket is the
 * one-time query parameter that carries a login from the auth host to a client's own host.
 * Neither is a JWT: an opaque reference to a row can be revoked by touching the row, and a
 * signed token cannot.
 */
@Injectable()
export class PortalSessionsService {
  private readonly logger = new Logger(PortalSessionsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Start a session. Returns the secret exactly once; it is not recoverable afterwards. */
  async create(
    owner: SessionOwner,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<{ id: string; secret: string; maxAgeMs: number }> {
    const secret = randomBytes(32).toString('base64url');
    const id = uuidv7();
    await this.db.insert(portalSessions).values({
      id,
      secretHash: hash(secret),
      kind: owner.kind,
      portalUserId: owner.portalUserId ?? null,
      staffUserId: owner.staffUserId ?? null,
      clientId: owner.clientId,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    });
    return { id, secret, maxAgeMs: SESSION_ABSOLUTE_MS };
  }

  /**
   * A cookie value to a session, or null.
   *
   * Null for every way a session can be over — unknown, revoked, past its absolute end, idle
   * too long, or (for a client session) belonging to a login that has since been disabled.
   * The last one is the important one: revoking a portal user must end their sessions even
   * if nothing remembered to revoke the session rows, so it is checked here, on every request,
   * against the user row rather than trusted from the session.
   */
  async resolve(secret: string): Promise<ResolvedSession | null> {
    if (!secret || secret.length > 200) return null;
    const [row] = await this.db
      .select({
        id: portalSessions.id,
        kind: portalSessions.kind,
        portalUserId: portalSessions.portalUserId,
        staffUserId: portalSessions.staffUserId,
        clientId: portalSessions.clientId,
        lastSeenAt: portalSessions.lastSeenAt,
        expiresAt: portalSessions.expiresAt,
        revokedAt: portalSessions.revokedAt,
        email: portalUsers.email,
        userDisabledAt: portalUsers.disabledAt,
        userClientId: portalUsers.clientId,
        staffEmail: staffUser.email,
        staffActive: staffUser.isActive,
      })
      .from(portalSessions)
      .leftJoin(portalUsers, eq(portalUsers.id, portalSessions.portalUserId))
      .leftJoin(staffUser, eq(staffUser.id, portalSessions.staffUserId))
      .where(eq(portalSessions.secretHash, hash(secret)))
      .limit(1);
    if (!row) return null;

    const now = Date.now();
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < now) return null;
    if (row.lastSeenAt.getTime() + SESSION_IDLE_MS < now) return null;

    if (row.kind === 'client') {
      // A client session whose user is gone, disabled, or — impossibly — moved to another
      // client is not a session. The join is a LEFT JOIN only so that a staff session, which
      // has no portal user, is not filtered out by it.
      if (!row.portalUserId || row.userDisabledAt || row.userClientId !== row.clientId) {
        return null;
      }
    } else if (!row.staffUserId || !row.staffActive) {
      // The same rule for the other kind: deactivating a colleague internally must also end
      // whatever client portals they had open, and it does so here rather than by anybody
      // remembering that portal sessions exist.
      return null;
    }

    if (row.lastSeenAt.getTime() + TOUCH_EVERY_MS < now) {
      // Detached on purpose: a failed timestamp write must not cost a client their request,
      // and it is not read back by anything on this path.
      void this.db
        .update(portalSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(portalSessions.id, row.id))
        .catch((err: Error) => this.logger.warn(`Could not touch session: ${err.message}`));
    }

    return {
      id: row.id,
      kind: row.kind as 'client' | 'staff',
      portalUserId: row.portalUserId,
      staffUserId: row.staffUserId,
      clientId: row.clientId,
      email: row.kind === 'staff' ? row.staffEmail : row.email,
    };
  }

  /** End one session. Idempotent: a second revoke matches nothing and that is fine. */
  async revoke(id: string): Promise<void> {
    await this.db
      .update(portalSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(portalSessions.id, id), isNull(portalSessions.revokedAt)));
  }

  /**
   * End every session of a portal login. Takes the caller's transaction so the sessions end
   * in the same commit as the revocation that ends them.
   */
  async revokeForPortalUser(tx: Tx | Database, portalUserId: string): Promise<void> {
    await tx
      .update(portalSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(portalSessions.portalUserId, portalUserId), isNull(portalSessions.revokedAt)));
  }

  // ── handoff tickets (P2) ──

  /**
   * A one-time, one-host, one-minute ticket that the target host turns into a session.
   *
   * `bindingHash` is **already** the SHA-256 of the nonce the browser was handed when it
   * started the login, and is stored as given. The two sides carry different
   * representations on purpose: the browser holds the nonce, and the login host — which is
   * a different host and has no business proving which browser this is — only ever sees the
   * hash. Hashing again here is what a previous version did, and it made every handoff fail
   * with "login expired", because redemption hashes the nonce exactly once.
   *
   * Null when the login began somewhere else, where there is no cookie on the target host
   * to bind to.
   */
  async issueTicket(
    owner: SessionOwner,
    targetHost: string,
    next: string,
    bindingHash?: string | null,
  ): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    await this.db.insert(portalHandoffTickets).values({
      id: uuidv7(),
      secretHash: hash(secret),
      kind: owner.kind,
      portalUserId: owner.portalUserId ?? null,
      staffUserId: owner.staffUserId ?? null,
      clientId: owner.clientId,
      targetHost,
      next,
      bindingHash: bindingHash ?? null,
      expiresAt: new Date(Date.now() + TICKET_MS),
    });
    // Sweep on the way through rather than from a timer: tickets are only ever created here,
    // so this is the one place that knows they accumulate. Detached — housekeeping.
    void this.db
      .delete(portalHandoffTickets)
      .where(lt(portalHandoffTickets.expiresAt, sql`now() - interval '1 hour'`))
      .catch((err: Error) => this.logger.warn(`Ticket sweep failed: ${err.message}`));
    return secret;
  }

  /**
   * Redeem a ticket on the host it was issued for. Deleting and reading in one statement is
   * what makes it single-use: two browsers racing on the same URL cannot both win.
   */
  /**
   * Redeem a ticket on the host it was issued for, by the browser that started the login.
   *
   * `bindingNonce` is the raw value from that browser's cookie — hashed here, once, and
   * compared with what `issueTicket` stored.
   */
  async redeemTicket(
    secret: string,
    host: string,
    bindingNonce?: string | null,
  ): Promise<{ owner: SessionOwner; next: string } | null> {
    if (!secret || secret.length > 200) return null;
    const [row] = await this.db
      .delete(portalHandoffTickets)
      .where(eq(portalHandoffTickets.secretHash, hash(secret)))
      .returning();
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    if (row.targetHost !== host) {
      this.logger.warn(`Handoff ticket for ${row.targetHost} presented at ${host}; refused`);
      return null;
    }
    if (row.bindingHash && (!bindingNonce || hash(bindingNonce) !== row.bindingHash)) {
      // The browser redeeming this is not the browser that started the login, so this is
      // somebody being handed a session rather than collecting their own.
      this.logger.warn('Handoff ticket redeemed by a browser that did not start the login');
      return null;
    }
    return {
      owner: {
        kind: row.kind as 'client' | 'staff',
        portalUserId: row.portalUserId ?? undefined,
        staffUserId: row.staffUserId ?? undefined,
        clientId: row.clientId,
      },
      next: row.next,
    };
  }
}

/**
 * `core.users` under another name.
 *
 * Both tables in this query are called `users` — one in `core`, one in `portal` — and
 * Postgres will not accept the same alias twice. Drizzle raises before it gets that far,
 * which is the good outcome: without the alias the join is simply impossible to write.
 */
const staffUser = alias(users, 'staff_user');

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
