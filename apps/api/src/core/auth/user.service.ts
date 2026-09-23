import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { ZitadelTokens } from './zitadel.tokens.js';
import { users } from '../db/core.schema.js';
import { INTERNAL_ROLE, rolesFrom } from './roles.js';

interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  /** Project roles from the verified token — the grant, not what the client asked for. */
  roles?: string[];
}

/**
 * How stale a stored name or email may get before the issuer is asked again.
 *
 * Not "on sign-in", although that is how it is described: this service never sees a sign-in.
 * `resolveFromClaims` runs on *every* request, and there is no session to hang a once-per-login
 * hook on — so the honest implementation is a refresh that happens at most this often per person.
 */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long somebody has to be away before coming back counts as signing in.
 *
 * The platform never sees a login. This app runs the OIDC exchange in the browser and
 * renews its token silently, so a genuine sign-in happens rarely and invisibly — asking
 * "when did Tomas log in" and answering with the last time a token was minted would report
 * a month ago for somebody who has been here all week.
 *
 * What a colleague means by the question is the first thing they did after being away, so
 * that is what is recorded, and the log says so in those words rather than claiming to know
 * about a login it never witnessed. Thirty minutes is the ordinary session gap.
 */
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * How often `last_seen_at` is actually written.
 *
 * This runs on every request, so writing each time would mean a row update per page load
 * per person for a column nothing reads in real time. Five minutes bounds it to a dozen
 * writes an hour and still measures a thirty-minute gap accurately.
 */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  /**
   * When each subject's profile was last compared against the issuer.
   *
   * In memory rather than a column, because losing it is harmless: a restart costs one userinfo
   * call per person on their next request, and that is also the repair mechanism if a refresh
   * ever fails. A column would need a migration to store something nobody queries.
   *
   * Single-instance assumption, matching every other in-process cache here. Two API instances
   * would each keep their own clock and refresh independently — twice the calls, same result.
   */
  private readonly profileCheckedAt = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tokens: ZitadelTokens,
  ) {}

  /**
   * Resolve the OIDC subject to a platform user, provisioning on first login (spec §6).
   *
   * The very first user becomes admin — otherwise a fresh install has no one who can
   * grant anything. Subsequent users default to 'member'.
   *
   * Provisioning is gated on the `internal` project role, and the gate is on CREATION
   * rather than on authentication. That split is deliberate:
   *
   *   Once client logins exist in the same Zitadel instance, "presented a valid token"
   *   stops meaning "works here". A client authenticating against the internal
   *   application would otherwise be provisioned as a member — an outsider handed the
   *   whole business, silently, on first sign-in.
   *
   *   Gating authentication instead would lock out every existing user the moment the
   *   role is introduced and before it is configured. An existing row is already an
   *   authorisation decision somebody made; the role is what it takes to write a new one.
   */
  async resolveFromClaims(claims: OidcClaims, accessToken: string): Promise<Actor> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.oidcSubject, claims.sub),
    });

    if (existing) {
      /*
       * A deactivated person is refused here, not merely hidden from pickers.
       *
       * `isActive` used to be read by one function — the assignee list — so somebody marked
       * inactive kept a working session and full sight of every client, rate and invoice. A
       * control labelled "deactivate" that does not deactivate is worse than no control,
       * because it is believed.
       *
       * Zitadel is still where access is really revoked, and this does not replace that. It
       * is the second lock: it takes effect the moment the flag flips, rather than whenever
       * somebody remembers to go and remove the role.
       */
      if (!existing.isActive) {
        this.logger.warn(`Refused deactivated user ${existing.email}`);
        throw new ForbiddenException('This account has been deactivated');
      }

      // Deliberately after the isActive gate: a refused account is refused without a call to
      // the issuer on its way out.
      await this.noteActivity(existing);
      await this.refreshProfile(existing, accessToken);

      return { userId: existing.id, role: existing.role as Actor['role'] };
    }

    /*
     * The profile is fetched BEFORE the role gate, not after.
     *
     * On this instance the access token carries only the standard eight claims — no
     * roles, no email — so a gate that reads the token alone rejects everyone regardless
     * of what has been granted. Userinfo is a server-to-server call to the issuer
     * authenticated with the access token, so a role it reports is as trustworthy as one
     * inside the token; the token is merely cheaper. This costs one extra call for a user
     * who is then refused, and this whole path runs once per person, not per request.
     */
    const profile = await this.fetchUserInfo(accessToken);
    const roles = claims.roles?.length
      ? claims.roles
      : rolesFrom((profile ?? {}) as Record<string, unknown>);

    if (!roles.includes(INTERNAL_ROLE)) {
      this.logger.warn(
        `Refused to provision '${profile?.email ?? claims.email ?? claims.sub}': no ` +
          `'${INTERNAL_ROLE}' role. Roles seen: ${roles.length > 0 ? roles.join(', ') : 'none'}. ` +
          'GET /core/auth/diagnostics shows which claims arrived.',
      );
      throw new ForbiddenException('No access to this platform');
    }

    const anyUser = await this.db.query.users.findFirst({ columns: { id: true } });
    const isFirstUser = anyUser === undefined;
    const id = uuidv7();
    const email = profile?.email ?? claims.email ?? claims.preferred_username ?? 'unknown';
    const role = isFirstUser ? 'admin' : 'member';

    // Concurrent first requests (the shell loads /me and /navigation in parallel) can
    // both reach this point, so the insert must be idempotent rather than racing on
    // the unique constraint. Whoever loses the race simply reads the winner's row.
    const [inserted] = await this.db
      .insert(users)
      .values({
        id,
        oidcSubject: claims.sub,
        email,
        displayName: profile?.name ?? claims.name ?? email,
        role,
      })
      .onConflictDoNothing({ target: users.oidcSubject })
      .returning({ id: users.id, role: users.role });

    if (inserted) {
      this.logger.log(`Provisioned user ${email}${isFirstUser ? ' as admin (first user)' : ''}`);
      return { userId: inserted.id, role: inserted.role as Actor['role'] };
    }

    const winner = await this.db.query.users.findFirst({
      where: eq(users.oidcSubject, claims.sub),
    });
    return { userId: winner!.id, role: winner!.role as Actor['role'] };
  }

  /**
   * Mark that this person is here, and record it as a sign-in when they have been away.
   *
   * Both facts come out of the row that was just read, so detecting the gap costs nothing
   * extra. The write is skipped entirely for somebody who was here minutes ago, which is
   * almost every request.
   *
   * Failures are logged and swallowed. An audit row is worth having and it is not worth a
   * colleague's request failing over — unlike the portal, where a read that cannot be
   * recorded is refused, because there the log is the reason an outsider may see anything
   * at all.
   */
  private async noteActivity(existing: { id: string; email: string; lastSeenAt: Date | null }) {
    const now = Date.now();
    const last = existing.lastSeenAt?.getTime() ?? 0;
    if (now - last < TOUCH_EVERY_MS) return;

    // A first sign-in has no previous visit, and reads as one rather than as a gap.
    const returning = now - last >= SESSION_GAP_MS;
    try {
      await this.db.transaction(async (tx) => {
        await tx.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, existing.id));
        if (!returning) return;
        await this.audit.record(tx, {
          actorId: existing.id,
          action: 'core.signed_in',
          entityType: 'user',
          entityId: existing.id,
          detail: {
            email: existing.email,
            // What "signed in" actually means here, carried with the row so a reader does
            // not have to know the constant: nothing since this moment, or nothing ever.
            since: existing.lastSeenAt?.toISOString() ?? null,
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Could not record activity for ${existing.email}: ${(err as Error).message}`);
    }
  }

  /**
   * Bring a stored name and email back in line with the identity provider.
   *
   * Zitadel owns who somebody is; this platform owns their role, rate and employment. Until
   * now that split was only true at the moment of provisioning — a colleague who married and
   * changed their name in Zitadel kept the old one here forever, on every task, timesheet and
   * person page, with no way to correct it short of SQL. `updatePerson` accepts no name.
   *
   * Only the two fields the issuer is authoritative for. Nothing here touches `role` or
   * `isActive`: those are decisions made in this application, and a profile refresh that
   * quietly reset a role would be a privilege change disguised as a name change.
   *
   * Awaited rather than detached. It costs one userinfo round trip to one request per person
   * per TTL window, which is cheaper than the alternative is subtle: a floating promise writing
   * to the database after its request has gone is unobservable when it fails and writes into a
   * closed pool when a test ends.
   */
  private async refreshProfile(
    existing: { id: string; oidcSubject: string; email: string; displayName: string },
    accessToken: string,
  ): Promise<void> {
    const now = Date.now();
    const checked = this.profileCheckedAt.get(existing.oidcSubject);
    if (checked !== undefined && now - checked < PROFILE_TTL_MS) return;

    /*
     * Stamped BEFORE the call, not after.
     *
     * The shell opens several requests in parallel, so stamping afterwards lets all of them
     * pass the staleness check together and fire one userinfo call each. Stamping first means
     * the first request through claims the work. A failed call then waits a full TTL to retry,
     * which is the right trade: the issuer being down is not a reason to call it on every
     * request.
     */
    this.profileCheckedAt.set(existing.oidcSubject, now);

    const profile = await this.fetchUserInfo(accessToken);
    if (!profile) return;

    // `??` not `||`: an issuer that reports an empty name must not overwrite a good one.
    const displayName = profile.name ?? profile.email ?? existing.displayName;
    const email = profile.email ?? existing.email;
    if (displayName === existing.displayName && email === existing.email) return;

    await this.db.update(users).set({ displayName, email }).where(eq(users.id, existing.id));
    this.logger.log(
      `Profile changed upstream for ${existing.email}: ` +
        `${existing.displayName} <${existing.email}> → ${displayName} <${email}>`,
    );
  }

  /**
   * Public for the diagnostics route, which needs to show what the issuer reports.
   *
   * The call itself is `ZitadelTokens`, shared with the portal's invitation claim. What is not
   * shared is what may be done with the answer: here it is a profile and a set of roles, and a
   * failure means carrying on with what the token said; there it decides whether somebody may
   * claim a client's invitation, and only a verified address will do. Same request, two rules,
   * and each rule stays in the file that depends on it.
   */
  async fetchUserInfo(accessToken: string): Promise<OidcClaims | null> {
    return (await this.tokens.userInfo(accessToken)) as OidcClaims | null;
  }

  /**
   * A member by their Zitadel subject, or undefined — with no provisioning.
   *
   * `resolveFromClaims` is the other way in and does provision, which is right for the
   * internal app and wrong for the portal: an employee opening a client's portal should be
   * recognised if they already work here, and never *created* by the act of visiting.
   * Deactivated people are not returned, so the flag that ends a session internally ends a
   * staff portal session too (Phase 8, P5).
   */
  async bySubject(subject: string) {
    const row = await this.db.query.users.findFirst({ where: eq(users.oidcSubject, subject) });
    return row?.isActive ? row : undefined;
  }

  /**
   * Whether an address belongs to somebody who works here.
   *
   * Asked before a portal invitation is claimed by email: a colleague whose Zitadel account
   * happens to match a pending invitation must not become that client's portal user. It is
   * the one case `bySubject` cannot catch, because a colleague who has never signed in to
   * the internal app has no subject on their row yet.
   */
  async memberWithEmail(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .limit(1);
    return row !== undefined;
  }

  async byId(userId: string) {
    return this.db.query.users.findFirst({ where: eq(users.id, userId) });
  }

  /**
   * Who work can be assigned to.
   *
   * `isActive` gates this and, until now, was written on every provisioning and read by
   * nothing — a column that existed as an intention. Someone who has left should stop
   * appearing in pickers while remaining attached to the hours and tasks they own, which
   * is the whole reason the flag is a flag rather than a delete.
   *
   * Names only. This is a picker's source, not a directory, so it carries no email, no
   * role and no subject claim: three things a colleague list would leak into every screen
   * that needs to say "assign to".
   */
  /**
   * The directory, for the people page.
   *
   * Separate from `listAssignable` rather than a superset of it, and that separation is the
   * point: a picker needs names, and it is used on a dozen screens by everybody. This carries
   * email, role, status and money, and is reached from one page by somebody who may manage
   * people. Merging them would leak the second set into every screen that needs the first.
   */
  async people(actor: Actor): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db.select().from(users).orderBy(users.displayName);
    /*
     * Cost rate is admin-only, and stripped here rather than filtered in the query.
     *
     * A colleague's salary is inferable from it, which makes it unlike everything else on the
     * row. Removing the key entirely rather than nulling it means a client that shows "—" for
     * an unset rate cannot accidentally show "—" for a hidden one and imply it is unset.
     */
    const seesMoney = actor.role === 'admin';
    return rows.map((r) => {
      // Built up rather than destructured-and-dropped, so the set of fields that leaves this
      // method is a list you can read rather than a subtraction you have to work out.
      const person: Record<string, unknown> = {
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        role: r.role,
        isActive: r.isActive,
        jobTitle: r.jobTitle,
        startedOn: r.startedOn,
        weeklyHours: r.weeklyHours,
        createdAt: r.createdAt,
      };
      // The Zitadel subject is deliberately not on that list: it is the key an impersonation
      // would need, and no screen has ever had a reason to show it.
      if (seesMoney) person.costRateCents = r.costRateCents;
      return person;
    });
  }

  /**
   * One person, in the same shape and with the same field stripped.
   *
   * Routed through `people()` rather than repeating the projection. The list is two rows at
   * this size, so filtering in memory costs nothing measurable — and the cost rate being
   * omitted for a non-admin is a rule that must not have two implementations, because the
   * second one is where it eventually gets forgotten.
   */
  async person(actor: Actor, id: string): Promise<Record<string, unknown> | null> {
    const all = await this.people(actor);
    return all.find((p) => p.id === id) ?? null;
  }

  /**
   * Change what the business knows about somebody.
   *
   * Identity fields are absent on purpose: email and display name come from Zitadel on every
   * sign-in, so editing them here would produce a value that silently reverts the next time
   * that person logs in — the worst kind of field, one that accepts your input and discards it.
   */
  async updatePerson(
    actor: Actor,
    id: string,
    patch: {
      role?: 'admin' | 'member';
      isActive?: boolean;
      jobTitle?: string | null;
      startedOn?: string | null;
      costRateCents?: number | null;
      weeklyHours?: number | null;
    },
  ) {
    const target = await this.byId(id);
    if (!target) throw new NotFoundException('No such person');

    /*
     * You may not lock yourself out.
     *
     * Demoting or deactivating yourself is a single click away from a platform nobody can
     * administer, and the recovery is a hand-written UPDATE against production. Somebody else
     * can always do it to you — this only stops the accident.
     */
    if (id === actor.userId && (patch.role === 'member' || patch.isActive === false)) {
      throw new BadRequestException('Ask another admin to do that to your own account');
    }

    /*
     * And the last admin may not stop being one.
     *
     * Same failure, one step removed: with a single admin, demoting anybody else is safe, but
     * demoting *them* leaves a platform whose settings, approvals and permissions nobody can
     * reach.
     */
    const losingAdmin = target.role === 'admin' && (patch.role === 'member' || patch.isActive === false);
    if (losingAdmin) {
      const admins = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
      if (admins.length <= 1) {
        throw new BadRequestException('That is the only administrator — promote somebody else first');
      }
    }

    if (patch.costRateCents !== undefined && actor.role !== 'admin') {
      throw new ForbiddenException('Only an administrator may set a cost rate');
    }

    const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  }

  /**
   * Names and contracted hours, for anything that needs a denominator.
   *
   * Kept apart from `listAssignable` even though it is one column wider, because that one is a
   * picker's source used on a dozen screens and this is read by two widgets. The rule that
   * matters is the one it inherits: a person with no contracted hours comes back with null, and
   * a caller must draw no bar rather than assume forty.
   */
  async capacities(): Promise<Array<{ id: string; displayName: string; weeklyHours: number | null }>> {
    return this.db
      .select({ id: users.id, displayName: users.displayName, weeklyHours: users.weeklyHours })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.displayName);
  }

  /**
   * Display names for a set of user ids, active or not.
   *
   * Deliberately without the `isActive` filter every other lookup here carries. Those answer
   * "who can be given work", and a colleague who has left is correctly absent. This answers
   * "whose hours were these", and a historical record that turns a departed colleague's name
   * back into a uuid is a record that rewrites the past — the hours ledger rewrites closed
   * months in place, so the name has to keep resolving for as long as the row exists.
   */
  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  async listAssignable(): Promise<Array<{ id: string; displayName: string }>> {
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.displayName);
    return rows;
  }
}
