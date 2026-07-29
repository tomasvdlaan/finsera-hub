import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../core/audit/audit.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { portalUsers } from './portal.schema.js';
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

    // Deliberately not awaited on the request path — a failed timestamp write should not
    // cost a client their session, and nothing reads it synchronously.
    void this.db
      .update(portalUsers)
      .set({ lastSeenAt: new Date() })
      .where(eq(portalUsers.id, row.id))
      .catch((err: Error) => this.logger.warn(`Could not record last seen: ${err.message}`));

    return { portalUserId: row.id, clientId: row.clientId, email: row.email };
  }

  /** Invite a client login. Internal-only: creating one is how a client gets in at all. */
  async invite(
    actor: Actor,
    input: { clientId: string; email: string; oidcSubject: string; displayName?: string },
  ): Promise<{ id: string }> {
    await this.require(actor, 'portal.admin');

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(portalUsers).values({
        id,
        clientId: input.clientId,
        email: input.email,
        oidcSubject: input.oidcSubject,
        displayName: input.displayName ?? input.email,
        invitedBy: actor.userId,
      });
      // Audited in the same transaction as the grant: a grant of access to a client's
      // data with no record of who gave it is worse than no grant at all.
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.invited',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: input.email, clientId: input.clientId },
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
  async revoke(actor: Actor, id: string): Promise<void> {
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

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.revoked',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: updated.email },
      });
      this.logger.log(`Portal access revoked for ${updated.email}`);
    });
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
      })
      .from(portalUsers)
      .where(eq(portalUsers.clientId, clientId));
  }
}
