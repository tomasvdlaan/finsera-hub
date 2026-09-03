import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { portalSessions, portalUsers } from './portal.schema.js';
import type { PortalVisitor } from './portal.projection.js';

/**
 * Who may log into the portal, and which client they are.
 *
 * The one rule that shapes this whole service: **a portal login is invited, never
 * self-provisioned**. Internal users are provisioned just-in-time on first sign-in, which
 * is right when the identity provider only admits people we hired. It is exactly wrong
 * here — with JIT, anyone who could obtain a token from the portal project would become a
 * portal user, and the only remaining question would be whose data they get mapped to.
 *
 * So an unrecognised subject is refused rather than created, and the client mapping is
 * written by us, in advance, as a column.
 */
@Injectable()
export class PortalUsersService {
  private readonly logger = new Logger(PortalUsersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve a verified token subject to a visitor, or refuse.
   *
   * Called after the signature is checked, so the question here is not "is this token
   * real" but "is this subject someone we invited, and are they still allowed in".
   */
  async resolveFromSubject(subject: string): Promise<PortalVisitor> {
    // select().from() rather than db.query.*: the relational API is typed on the core
    // schema alone, so a module's own tables are not reachable through it.
    const [row] = await this.db
      .select()
      .from(portalUsers)
      .where(eq(portalUsers.oidcSubject, subject))
      .limit(1);

    if (!row) {
      // Logged, because in this module an unrecognised subject is the interesting event:
      // it means a valid portal-project token exists for someone we never invited.
      this.logger.warn(`Portal sign-in refused: subject '${subject}' was never invited`);
      throw new ForbiddenException('No portal access');
    }

    if (row.disabledAt) {
      this.logger.warn(`Portal sign-in refused: ${row.email} is disabled`);
      throw new ForbiddenException('No portal access');
    }

    /*
     * The previous visit is carried forward before this one is stamped.
     *
     * `last_seen_at` becomes now, so on its own it can never answer "what is new since I
     * was last here" — everything is older than now. Moving the old value across at the
     * same moment is what makes the front page's one genuinely personal claim possible.
     *
     * Deliberately not awaited: a failed timestamp write should not cost a client their
     * session, and nothing reads it synchronously. This runs once per sign-in, not per
     * request, so the value it writes is a visit rather than a heartbeat.
     */
    void this.db
      .update(portalUsers)
      .set({ previousSeenAt: row.lastSeenAt, lastSeenAt: new Date() })
      .where(eq(portalUsers.id, row.id))
      .catch((err: Error) => this.logger.warn(`Could not record last seen: ${err.message}`));

    return {
      portalUserId: row.id,
      clientId: row.clientId,
      email: row.email,
      displayName: row.displayName,
      previousSeenAt: row.previousSeenAt ?? null,
    };
  }

  /**
   * Bind a verified email to a pending invitation, once.
   *
   * The claim is deliberately narrow. The email must come from the identity provider and
   * be verified there — never from anything the browser sent — it must match an invitation
   * exactly, and that invitation must still be waiting for a subject. A second person
   * signing in with the same address finds nothing left to claim.
   *
   * This is not JIT provisioning wearing a hat: no invitation, no account. Somebody
   * internal still decided this person may see this client's data, in advance.
   */
  async claimInvitation(subject: string, verifiedEmail: string): Promise<PortalVisitor | null> {
    const email = verifiedEmail.trim().toLowerCase();
    if (!email) return null;

    // One Zitadel account is one client, enforced by a unique index. Somebody who works
    // for two clients needs two accounts — merging them would mean a session that spans
    // clients, which is the thing this module exists to prevent. Checked here so the
    // second attempt is a clean refusal rather than a constraint violation surfacing as a
    // 500, and so the log says which subject tried.
    const [bound] = await this.db
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(eq(portalUsers.oidcSubject, subject))
      .limit(1);
    if (bound) {
      this.logger.warn(
        `Subject '${subject}' already has a portal login and cannot claim a second invitation`,
      );
      return null;
    }

    // One invitation, chosen explicitly, then bound by id.
    //
    // Updating by email alone would match every pending invitation for that address — and
    // an address invited to two clients would have both rows updated to the same subject
    // in one statement, colliding on the unique index. Which client someone lands in is a
    // decision, so it is made here (the oldest invitation) rather than by whatever order
    // the database happened to return.
    const [candidate] = await this.db
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(
        and(
          sql`lower(${portalUsers.email}) = ${email}`,
          isNull(portalUsers.oidcSubject),
          isNull(portalUsers.disabledAt),
        ),
      )
      .orderBy(portalUsers.createdAt)
      .limit(1);
    if (!candidate) return null;

    const [claimed] = await this.db
      .update(portalUsers)
      .set({ oidcSubject: subject })
      .where(and(eq(portalUsers.id, candidate.id), isNull(portalUsers.oidcSubject)))
      .returning({
        id: portalUsers.id,
        clientId: portalUsers.clientId,
        email: portalUsers.email,
      });

    if (!claimed) return null;

    this.logger.log(`Portal invitation for ${claimed.email} claimed by subject '${subject}'`);
    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: null,
        action: 'portal.invitation.claimed',
        entityType: 'portal_user',
        entityId: claimed.id,
        detail: { email: claimed.email, subject },
      });
    });

    return {
      portalUserId: claimed.id,
      clientId: claimed.clientId,
      email: claimed.email,
      displayName: null,
      previousSeenAt: null,
    };
  }

  /** Invite a client login. Internal-only: creating one is how a client gets in at all. */
  async invite(
    actor: Actor,
    input: { clientId: string; email: string; oidcSubject?: string; displayName?: string },
  ): Promise<{ id: string }> {
    await this.require(actor, 'portal.admin');

    const email = input.email.trim();
    if (!email.includes('@')) throw new BadRequestException('That is not an email address');

    // A login with nowhere to go. The portal lives at the client's own address (Phase 8),
    // so a client without one has no portal, and inviting somebody to it would produce a
    // person who signs in successfully and lands nowhere.
    const { rows } = await this.db.execute<{ portal_slug: string | null }>(
      sql`SELECT portal_slug FROM crm.clients WHERE id = ${input.clientId} AND archived_at IS NULL`,
    );
    if (!rows[0]) throw new NotFoundException('No such client');
    if (!rows[0].portal_slug) {
      throw new BadRequestException('Set a portal address for this client before inviting anyone');
    }

    const existing = await this.db
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(
        and(
          eq(portalUsers.clientId, input.clientId),
          sql`lower(${portalUsers.email}) = ${email.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new BadRequestException('That address already has access to this client');
    }

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(portalUsers).values({
        id,
        clientId: input.clientId,
        email,
        oidcSubject: input.oidcSubject ?? null,
        displayName: input.displayName ?? email,
        invitedBy: actor.userId,
      });
      // Audited in the same transaction as the grant: a grant of access to a client's
      // data with no record of who gave it is worse than no grant at all.
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.invited',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: input.email, clientId: input.clientId, pending: !input.oidcSubject },
      });
    });
    this.logger.log(`Portal access granted to ${input.email} for client ${input.clientId}`);
    return { id };
  }

  /**
   * Revoke access without deleting the row.
   *
   * A deletion would take the audit trail of what this login saw with it, and "who had
   * access to this client's invoices last year" is a question that gets asked after
   * somebody leaves, not before.
   */
  async revoke(actor: Actor, id: string): Promise<{ id: string; status: 'revoked' }> {
    await this.require(actor, 'portal.admin');

    await this.db.transaction(async (tx) => {
      // The `isNull` predicate makes this idempotent-safe rather than idempotent: a second
      // revoke matches nothing and is reported, instead of writing a fresh timestamp over
      // the real one and losing when access actually ended.
      const [updated] = await tx
        .update(portalUsers)
        .set({ disabledAt: new Date() })
        .where(and(eq(portalUsers.id, id), isNull(portalUsers.disabledAt)))
        .returning({ id: portalUsers.id, email: portalUsers.email });

      if (!updated) throw new NotFoundException('No such active portal user');

      // Their sessions end in the same commit. `PortalSessionsService.resolve` would refuse
      // them anyway on the next request, by re-reading `disabled_at` — this is so that the
      // session rows say so too, and "when did their access actually end" has one answer.
      await tx
        .update(portalSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(portalSessions.portalUserId, id), isNull(portalSessions.revokedAt)));

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.revoked',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: updated.email },
      });
      this.logger.log(`Portal access revoked for ${updated.email}`);
    });

    // Returned rather than void: a 200 with an empty body is not JSON, and every caller
    // that parses the response chokes on it. Found by clicking Revoke, not by a test —
    // the service tests never went through HTTP.
    return { id, status: 'revoked' };
  }

  private async require(actor: Actor, capability: string): Promise<void> {
    if (!(await this.permissions.can(actor, capability))) {
      throw new ForbiddenException(`Missing capability '${capability}'`);
    }
  }

  async listForClient(actor: Actor, clientId: string) {
    await this.require(actor, 'portal.admin');
    return this.db
      .select({
        id: portalUsers.id,
        email: portalUsers.email,
        displayName: portalUsers.displayName,
        disabledAt: portalUsers.disabledAt,
        lastSeenAt: portalUsers.lastSeenAt,
        // Whether they have ever actually signed in, which is the question asked when
        // someone says "I never got access".
        pending: sql<boolean>`${portalUsers.oidcSubject} IS NULL`,
      })
      .from(portalUsers)
      .where(eq(portalUsers.clientId, clientId));
  }
}
