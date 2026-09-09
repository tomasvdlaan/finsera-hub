import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '@platform/contracts';
import { AuditService } from '../../core/audit/audit.service.js';
import { UserService } from '../../core/auth/user.service.js';
import { DB, type Database } from '../../core/db/db.module.js';
import { PermissionService } from '../../core/permissions/permission.service.js';
import { RegistryService } from '../../core/registry/registry.service.js';
import { SESSION_IDLE_MS } from './portal-sessions.service.js';
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
    private readonly users: UserService,
    private readonly registry: RegistryService,
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
      seesInvoices: row.seesInvoices,
      seesQuotes: row.seesQuotes,
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
        seesInvoices: portalUsers.seesInvoices,
        seesQuotes: portalUsers.seesQuotes,
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
      seesInvoices: claimed.seesInvoices,
      seesQuotes: claimed.seesQuotes,
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

    /*
     * A colleague's address can never become a client's portal login, so it is refused here
     * rather than at the sign-in that would fail weeks later.
     *
     * `claimByEmail` already blocks it, deliberately — a member who happened to share an
     * address with a pending invitation would otherwise become that client's portal user and
     * the row would say so forever. But it blocks it at the *end*: the invitation is created,
     * the mail goes out, the client sets a password, and the refusal arrives as four words on
     * a screen with the reason in a log file. This is the same rule, said at the only moment
     * anybody can act on it.
     */
    if (await this.users.memberWithEmail(email)) {
      throw new BadRequestException(
        `${email} is a colleague's account, so it cannot be a client portal login. ` +
          'Invite an address at the client instead.',
      );
    }

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

    const [existing] = await this.db
      .select({ id: portalUsers.id, disabledAt: portalUsers.disabledAt })
      .from(portalUsers)
      .where(
        and(
          eq(portalUsers.clientId, input.clientId),
          sql`lower(${portalUsers.email}) = ${email.toLowerCase()}`,
        ),
      )
      .limit(1);
    /*
     * A revoked login is not a free address, and it says so.
     *
     * Inviting the same person again cannot work and must not look like it might: the row
     * is still there (revoking keeps it, for the audit trail), `(email, client_id)` is
     * unique, and if they ever signed in their subject is on that row and unique too — so
     * a second row would be refused by the database, and a second *subject* could never be
     * claimed by the same person anyway. Restoring the row is the only thing that means
     * what the person asking wants, so that is what the message names.
     */
    if (existing?.disabledAt) {
      throw new BadRequestException(
        'That address had access and it was revoked — restore it instead of inviting again',
      );
    }
    if (existing) {
      throw new BadRequestException('That address already has access to this client');
    }

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      /*
       * A person, not a permission row.
       *
       * `portal_user` has been a declared entity type since Phase 7 and nothing ever wrote
       * one, so the type existed and the rows did not: a client login could not be linked to
       * the contact it belongs to, could not be mentioned in a comment, did not appear in
       * search, and had no page of its own to be found on. Registering here — in the same
       * transaction as the login itself, so there is never one without the other — is what
       * makes "who is this person and what have they been given" a page rather than a query.
       */
      await this.registry.register(tx, {
        id,
        entityType: 'portal_user',
        displayName: input.displayName?.trim() || email,
        urlPath: `/portal/users/${id}`,
      });
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
   * Bind an invitation to the account we just created for it.
   *
   * The subject is normally claimed on first sign-in, by an address Zitadel says is
   * verified. When we made the account ourselves there is nothing to guess: writing the
   * subject now closes the small window in which somebody else's verified address could
   * have claimed the invitation, and makes the row say who it is for before they ever
   * arrive.
   */
  async attachSubject(actor: Actor, id: string, oidcSubject: string): Promise<void> {
    await this.require(actor, 'portal.admin');
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(portalUsers)
        .set({ oidcSubject })
        .where(and(eq(portalUsers.id, id), isNull(portalUsers.oidcSubject)))
        .returning({ id: portalUsers.id, email: portalUsers.email });
      // Already bound, to this account or another. Not an error — a re-issued link for
      // somebody who has signed in once is the ordinary case — and nothing to write.
      if (!updated) return;
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.account_created',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: updated.email, oidcSubject },
      });
    });
  }

  /** One invitation, by id — for the routes that re-issue a link. */
  /**
   * Let this invitation bind to a different account than the one it bound to.
   *
   * `claimInvitation` only ever claims a row whose subject is null, which is what stops one
   * Zitadel account quietly inheriting another's portal — and it also means a row bound once
   * is bound for good. That is right until the account behind it is gone: a client who was
   * re-created in Zitadel, or a test account replaced. Their row still names the old subject,
   * every sign-in resolves to nothing, and the message is the same "no access" as a person
   * who was never invited at all.
   *
   * So this clears the binding and nothing else. The invitation, the client and the audit
   * trail stay; the next sign-in with this address claims it afresh. Deliberately not part of
   * "revoke and re-invite" — that loses the row's history, and the address is unique per
   * client so the re-invite is refused anyway.
   *
   * Idempotent: unbinding a row that was never bound is not an error, it is a no-op with the
   * same end state.
   */
  async unbind(actor: Actor, id: string): Promise<{ id: string; pending: true }> {
    await this.require(actor, 'portal.admin');

    const [row] = await this.db
      .select({ id: portalUsers.id, email: portalUsers.email, oidcSubject: portalUsers.oidcSubject })
      .from(portalUsers)
      .where(eq(portalUsers.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('No such portal login');
    if (!row.oidcSubject) return { id, pending: true };

    await this.db.transaction(async (tx) => {
      await tx.update(portalUsers).set({ oidcSubject: null }).where(eq(portalUsers.id, id));
      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal_user.unbind',
        entityType: 'portal_user',
        entityId: id,
        // The subject that was released, because "who could sign in as this before" is the
        // question asked afterwards and nothing else records it.
        detail: { email: row.email, releasedSubject: row.oidcSubject },
      });
    });
    this.logger.log(`Portal login ${row.email} unbound from subject '${row.oidcSubject}'`);
    return { id, pending: true };
  }

  async byId(actor: Actor, id: string) {
    await this.require(actor, 'portal.admin');
    const [row] = await this.db
      .select({
        id: portalUsers.id,
        clientId: portalUsers.clientId,
        email: portalUsers.email,
        displayName: portalUsers.displayName,
        oidcSubject: portalUsers.oidcSubject,
        disabledAt: portalUsers.disabledAt,
        seesInvoices: portalUsers.seesInvoices,
        seesQuotes: portalUsers.seesQuotes,
        invitedBy: portalUsers.invitedBy,
        lastSeenAt: portalUsers.lastSeenAt,
        createdAt: portalUsers.createdAt,
      })
      .from(portalUsers)
      .where(eq(portalUsers.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('No such portal user');
    return row;
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

  /**
   * Give a revoked login its access back.
   *
   * The counterpart revoking has always needed. Because the row survives being revoked and
   * `(email, client_id)` is unique, re-inviting somebody is not merely awkward but
   * impossible — and for anyone who had signed in, their subject is on that row, so no
   * fresh invitation could be claimed by them either. This clears `disabled_at` on the row
   * that already exists, which is also what keeps the history in one place: one login, one
   * trail of when access started, ended and started again.
   *
   * Their old sessions stay revoked. Access is restored, not resumed — somebody whose
   * access was taken away signs in again, and that sign-in is a line in the audit log.
   */
  async reinstate(actor: Actor, id: string): Promise<{ id: string; status: 'active' }> {
    await this.require(actor, 'portal.admin');

    await this.db.transaction(async (tx) => {
      // `isNotNull` for the same reason revoke uses `isNull`: reinstating an active login
      // is a mistake to report, not a no-op to absorb.
      const [updated] = await tx
        .update(portalUsers)
        .set({ disabledAt: null })
        .where(and(eq(portalUsers.id, id), isNotNull(portalUsers.disabledAt)))
        .returning({ id: portalUsers.id, email: portalUsers.email });

      if (!updated) throw new NotFoundException('No such revoked portal user');

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal.reinstated',
        entityType: 'portal_user',
        entityId: id,
        detail: { email: updated.email },
      });
      this.logger.log(`Portal access restored for ${updated.email}`);
    });

    return { id, status: 'active' };
  }

  /**
   * Change what we call somebody, and which sections they see.
   *
   * One method for both because they are one screen and one audit line: "Bob is now
   * operations and no longer sees the invoices" is a single decision somebody made. Splitting
   * it would give two half-records of it.
   *
   * The email is deliberately not editable. It is what an invitation binds to and what a
   * verified address is matched against, so changing it would either strand the person on the
   * old address or hand their access to whoever holds the new one. Revoke and invite instead.
   */
  async update(
    actor: Actor,
    id: string,
    input: { displayName?: string; seesInvoices?: boolean; seesQuotes?: boolean },
  ): Promise<void> {
    await this.require(actor, 'portal.admin');

    const [before] = await this.db
      .select({
        id: portalUsers.id,
        email: portalUsers.email,
        displayName: portalUsers.displayName,
        seesInvoices: portalUsers.seesInvoices,
        seesQuotes: portalUsers.seesQuotes,
      })
      .from(portalUsers)
      .where(eq(portalUsers.id, id))
      .limit(1);
    if (!before) throw new NotFoundException('No such portal login');

    const displayName =
      input.displayName === undefined ? before.displayName : input.displayName.trim() || null;
    const seesInvoices = input.seesInvoices ?? before.seesInvoices;
    const seesQuotes = input.seesQuotes ?? before.seesQuotes;

    await this.db.transaction(async (tx) => {
      await tx
        .update(portalUsers)
        .set({ displayName, seesInvoices, seesQuotes })
        .where(eq(portalUsers.id, id));

      // The registry holds its own copy of the name, because search and the link picker read
      // one table rather than every module's. A rename that stopped here would leave the old
      // name in every mention of this person.
      if (displayName !== before.displayName) {
        await this.registry.updateDisplay(tx, id, { displayName: displayName ?? before.email });
      }

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal_user.update',
        entityType: 'portal_user',
        entityId: id,
        // Before and after, not just after: "when did Bob lose the invoices" is the question,
        // and an entry saying `seesInvoices: false` cannot answer it if it was already false.
        detail: {
          email: before.email,
          ...(displayName !== before.displayName
            ? { displayName: { from: before.displayName, to: displayName } }
            : {}),
          ...(seesInvoices !== before.seesInvoices
            ? { seesInvoices: { from: before.seesInvoices, to: seesInvoices } }
            : {}),
          ...(seesQuotes !== before.seesQuotes
            ? { seesQuotes: { from: before.seesQuotes, to: seesQuotes } }
            : {}),
        },
      });
    });
  }

  /**
   * Every sign-in this person has made, and what is still open.
   *
   * Read from `portal.sessions` rather than from the audit log, though both record a login.
   * A session row is the thing itself — it says when it started, from where, when it was last
   * used, and whether it is still live — where the audit entry is a note that it happened.
   * And because a session can be ended, this list is also the place to end one.
   *
   * Nothing here is new capture. These rows have been written since Phase 8 and never read,
   * which is the ordinary way a system ends up unable to answer "who has been in".
   */
  async history(
    actor: Actor,
    id: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
      ip: string | null;
      userAgent: string | null;
      status: 'active' | 'ended' | 'expired';
    }>
  > {
    await this.require(actor, 'portal.admin');

    const rows = await this.db
      .select({
        id: portalSessions.id,
        createdAt: portalSessions.createdAt,
        lastSeenAt: portalSessions.lastSeenAt,
        expiresAt: portalSessions.expiresAt,
        revokedAt: portalSessions.revokedAt,
        ip: portalSessions.ip,
        userAgent: portalSessions.userAgent,
      })
      .from(portalSessions)
      .where(eq(portalSessions.portalUserId, id))
      .orderBy(desc(portalSessions.createdAt))
      .limit(Math.min(limit, 200));

    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      // Idle expiry is a rule in `PortalSessionsService`, not a column, so a session can be
      // dead without any row saying so. Recomputing it here rather than reporting `revokedAt`
      // alone is what stops this list showing a fortnight-old session as "active".
      status: r.revokedAt
        ? ('ended' as const)
        : r.expiresAt.getTime() < now || r.lastSeenAt.getTime() + SESSION_IDLE_MS < now
          ? ('expired' as const)
          : ('active' as const),
    }));
  }

  /**
   * End one session without touching the login.
   *
   * The narrow version of revoking: a laptop left at a client's office, a browser on a shared
   * machine. Revoking the person ends every session and their access with it; this ends one
   * browser and they can sign in again.
   */
  async endSession(actor: Actor, id: string, sessionId: string): Promise<{ id: string }> {
    await this.require(actor, 'portal.admin');

    await this.db.transaction(async (tx) => {
      // Bound to the person as well as the session: the session id comes from a URL, and
      // "end this session" must not become "end any session" because the wrong id was pasted.
      const [ended] = await tx
        .update(portalSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(portalSessions.id, sessionId),
            eq(portalSessions.portalUserId, id),
            isNull(portalSessions.revokedAt),
          ),
        )
        .returning({ id: portalSessions.id });
      if (!ended) throw new NotFoundException('No such open session');

      await this.audit.record(tx, {
        actorId: actor.userId,
        action: 'portal_user.session_ended',
        entityType: 'portal_user',
        entityId: id,
        detail: { sessionId },
      });
    });
    return { id: sessionId };
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
        seesInvoices: portalUsers.seesInvoices,
        seesQuotes: portalUsers.seesQuotes,
        // Whether they have ever actually signed in, which is the question asked when
        // someone says "I never got access".
        pending: sql<boolean>`${portalUsers.oidcSubject} IS NULL`,
      })
      .from(portalUsers)
      .where(eq(portalUsers.clientId, clientId));
  }
}
