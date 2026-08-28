import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
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

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

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

  /** Public for the diagnostics route, which needs to show what the issuer reports. */
  async fetchUserInfo(accessToken: string): Promise<OidcClaims | null> {
    const issuer = process.env.ZITADEL_ISSUER;
    if (!issuer) return null;
    try {
      const res = await fetch(`${issuer}/oidc/v1/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`userinfo returned ${res.status}; provisioning with token claims only`);
        return null;
      }
      return (await res.json()) as OidcClaims;
    } catch (err) {
      this.logger.warn(`userinfo unreachable (${(err as Error).message}); using token claims`);
      return null;
    }
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

  async listAssignable(): Promise<Array<{ id: string; displayName: string }>> {
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.displayName);
    return rows;
  }
}
