import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { users } from '../db/core.schema.js';
import { INTERNAL_ROLE } from './roles.js';

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
      return { userId: existing.id, role: existing.role as Actor['role'] };
    }

    if (!claims.roles?.includes(INTERNAL_ROLE)) {
      this.logger.warn(
        `Refused to provision '${claims.email ?? claims.sub}': the token carries no ` +
          `'${INTERNAL_ROLE}' role. Grant it in Zitadel if this is a colleague.`,
      );
      throw new ForbiddenException('No access to this platform');
    }

    // The access token carries only `sub` — profile claims live at the userinfo
    // endpoint. Fetched once, at provisioning, rather than on every request.
    const profile = await this.fetchUserInfo(accessToken);

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

  private async fetchUserInfo(accessToken: string): Promise<OidcClaims | null> {
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
}
