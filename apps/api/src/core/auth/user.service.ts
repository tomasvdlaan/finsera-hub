import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database } from '../db/db.module.js';
import { users } from '../db/core.schema.js';

interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
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
   */
  async resolveFromClaims(claims: OidcClaims): Promise<Actor> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.oidcSubject, claims.sub),
    });

    if (existing) {
      return { userId: existing.id, role: existing.role as Actor['role'] };
    }

    const anyUser = await this.db.query.users.findFirst({ columns: { id: true } });
    const isFirstUser = anyUser === undefined;
    const id = uuidv7();

    await this.db.insert(users).values({
      id,
      oidcSubject: claims.sub,
      email: claims.email ?? claims.preferred_username ?? 'unknown',
      displayName: claims.name ?? claims.email ?? 'Unknown user',
      role: isFirstUser ? 'admin' : 'member',
    });

    this.logger.log(
      `Provisioned user ${claims.email ?? claims.sub}${isFirstUser ? ' as admin (first user)' : ''}`,
    );

    return { userId: id, role: isFirstUser ? 'admin' : 'member' };
  }

  async byId(userId: string) {
    return this.db.query.users.findFirst({ where: eq(users.id, userId) });
  }
}
