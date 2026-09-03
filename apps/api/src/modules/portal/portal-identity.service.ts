import { Injectable, Logger, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { INTERNAL_ROLE, PORTAL_ROLE, hasRole } from '../../core/auth/roles.js';
import { UserService } from '../../core/auth/user.service.js';
import { PortalUsersService } from './portal-users.service.js';
import type { PortalVisitor } from './portal.projection.js';

/**
 * Who signed in — a client, or one of us.
 *
 * A union rather than a visitor with a flag, because the two are answers to different
 * questions. A client identity names *whose* data it may see, and comes from an invitation
 * row. A staff identity names a person and no client at all: which client an employee is
 * looking at comes from the hostname they opened, which is safe precisely because an
 * employee may see every client anyway (P5).
 */
export type PortalIdentity =
  | ({ kind: 'client' } & PortalVisitor)
  | { kind: 'staff'; staffUserId: string; email: string };

/**
 * Verifies a token from the portal application and resolves it to a visitor.
 *
 * Until Phase 8 this was the request guard, and ran on every request against a Bearer
 * token the SPA held. It now runs once, at login, on the access token the server-side code
 * exchange produced (`PortalOidcService`); the result becomes a session row and the browser
 * holds a cookie. Nothing about the checks changed — that was the point of moving them
 * rather than rewriting them.
 *
 * Three separate things have to be true, and conflating any two is how this goes wrong:
 *
 *   1. The token is genuine — signed by Zitadel, not expired. Standard.
 *   2. It was issued **for the portal application** — the audience. Necessary, and on its
 *      own worth less than it looks: Zitadel lets a client request an arbitrary audience
 *      scope and returns a token carrying it whether or not the holder has a grant for
 *      it. So `aud` restates what was asked for, not what was permitted.
 *   3. The holder **is a portal client** — the role. This is the one that authorises,
 *      because roles are written from server-side grants and cannot be requested into
 *      existence. Zitadel's own guidance is to verify roles in addition to `aud`.
 *
 * Then, and only then, `portal.users` decides *whose* data this is.
 *
 * Phase 8 adds a second answer at that last step. A subject that belongs to an active
 * `core.users` row is one of us, and gets a staff identity instead — an employee may open
 * any client's portal (P5). That is looked up FIRST, so an employee is never mistaken for
 * a client, and it rests on the same kind of evidence the client path does: a row we wrote
 * when they were hired, not a claim in a token. When role grants work, `internal` becomes
 * the matching second gate on that path.
 *
 * `audience` is still required rather than optional. The internal guard tolerates an empty
 * one (`audience || undefined`), defensible for a single trusted tenant and indefensible
 * here: an unset variable would silently turn a check off, which is the failure that looks
 * like everything working.
 */
@Injectable()
export class PortalIdentityService implements OnModuleInit {
  private readonly logger = new Logger(PortalIdentityService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly portalUsers: PortalUsersService,
    private readonly users: UserService,
  ) {}

  private get issuer() {
    return process.env.ZITADEL_ISSUER ?? '';
  }

  /** The portal application's client id — never the internal one. */
  private get audience() {
    return process.env.ZITADEL_PORTAL_CLIENT_ID ?? '';
  }

  /**
   * On unless explicitly switched off, and never off by accident.
   *
   * The opt-out is a named value rather than an absent one, so an unset or misspelled
   * variable leaves the check ON. That is the opposite of how the audience behaves in the
   * internal guard, and deliberately so: a security check that disappears when you forget
   * to configure something is the failure mode this module exists to avoid.
   */
  private get roleCheckEnabled() {
    return process.env.PORTAL_ROLE_CHECK !== 'off';
  }

  /**
   * An unconfigured portal admits nobody, rather than admitting everybody.
   *
   * Unset audience is not "skip the check" — that is the shape of the bug this guard
   * exists to prevent, and it is what the internal guard's `audience || undefined` would
   * do here. Below, an unset audience makes `verifyToken` reject every request.
   *
   * It is a warning rather than a fatal error only because the portal has no endpoints
   * yet; failing the whole platform's boot over an unconfigured feature nobody can reach
   * would be theatre. The equality check IS fatal, because two projects sharing a client
   * id is not a missing configuration — it is a wrong one, and it silently makes an
   * internal token valid at the portal.
   */
  onModuleInit(): void {
    if (this.audience && this.audience === process.env.ZITADEL_CLIENT_ID) {
      throw new Error(
        'ZITADEL_PORTAL_CLIENT_ID equals ZITADEL_CLIENT_ID. The portal needs its own ' +
          'Zitadel application, or the two are indistinguishable by audience.',
      );
    }
    if (!this.audience) {
      this.logger.warn(
        'ZITADEL_PORTAL_CLIENT_ID is not set — the portal will refuse every request. ' +
          'Set it to the portal application’s client id (see .env.example).',
      );
      return;
    }
    this.logger.log(`Portal auth configured for audience ${this.audience}`);

    if (!this.roleCheckEnabled) {
      // Loud, and on every boot. A temporary relaxation that nobody is reminded of is a
      // permanent one, and this is the sort of thing that is discovered years later.
      this.logger.warn(
        `PORTAL_ROLE_CHECK=off — the '${PORTAL_ROLE}' role is NOT required. Portal access ` +
          'rests on the audience and the portal.users invitation alone. Remove this ' +
          'setting once Zitadel role grants work.',
      );
    }
  }

  /** The three gates, in order: signature and audience, role, and the row that names who. */
  async identify(token: string): Promise<PortalIdentity> {
    if (!this.issuer) throw new UnauthorizedException('ZITADEL_ISSUER is not configured');

    // The fail-closed half of the boot warning above. Verifying without an audience would
    // accept any token this Zitadel instance ever issued, internal ones included.
    if (!this.audience) {
      this.logger.error('Portal request refused: ZITADEL_PORTAL_CLIENT_ID is not configured');
      throw new UnauthorizedException('Portal is not configured');
    }

    if (token.split('.').length !== 3) {
      this.logger.error(
        'Received an opaque access token. Set the portal application’s Auth Token Type ' +
          'to "JWT" (Token Settings) so it can be validated via JWKS.',
      );
      throw new UnauthorizedException('Opaque access token — expected a JWT');
    }

    let payload: JWTPayload;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(`${this.issuer}/oauth/v2/keys`));
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      }));
    } catch (err) {
      this.logger.warn(`Portal token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }

    const subject = payload.sub!;

    /*
     * Are they one of us? Asked before anything about clients, and answered by a row.
     *
     * The order matters more than it looks. Asking second would mean an employee who also
     * held a portal invitation resolved as that client — and the whole point of P5 is that
     * an employee's view of a portal is an employee's, audited under their own name.
     */
    const member = await this.users.bySubject(subject);
    if (member) {
      // The role that admits somebody to the platform at all. Same shape as the client
      // gate below, same switch: when Zitadel emits no roles (G6) both rest on the row.
      if (this.roleCheckEnabled && !hasRole(payload, INTERNAL_ROLE)) {
        this.logger.warn(
          `Portal sign-in refused: '${member.email}' has no '${INTERNAL_ROLE}' role`,
        );
        throw new UnauthorizedException('Invalid token');
      }
      return { kind: 'staff', staffUserId: member.id, email: member.email };
    }

    // The audience above is necessary and not sufficient: Zitadel will issue a token
    // carrying an audience the holder has no grant for, so `aud` restates the request
    // rather than proving authorisation. The role comes from a grant, so it does.
    if (this.roleCheckEnabled && !hasRole(payload, PORTAL_ROLE)) {
      this.logger.warn(
        `Portal token rejected: subject '${subject}' has no '${PORTAL_ROLE}' role`,
      );
      throw new UnauthorizedException('Invalid token');
    }

    // Third gate, and the only one that says *whose* data this is: an invitation we wrote.
    try {
      return { kind: 'client', ...(await this.portalUsers.resolveFromSubject(subject)) };
    } catch (err) {
      // An unknown subject may be someone signing in for the first time against an
      // invitation that names their email. Anything else — revoked, never invited — has
      // already thrown something more specific and is rethrown untouched.
      const claimed = await this.claimByEmail(token, subject);
      if (claimed) return { kind: 'client', ...claimed };
      throw err;
    }
  }

  /**
   * Bind a first-time sign-in to the invitation naming that email.
   *
   * The email is read from Zitadel's userinfo endpoint with the caller's own token, never
   * from a claim the caller could have shaped and never from the request body — and it is
   * used only if Zitadel says it is verified. Without `email_verified`, an address is a
   * string somebody typed, and this would be a way to claim another company's invitation
   * by naming it.
   */
  private async claimByEmail(token: string, subject: string): Promise<PortalVisitor | null> {
    try {
      const res = await fetch(`${this.issuer}/oidc/v1/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;

      const info = (await res.json()) as { email?: string; email_verified?: boolean };
      if (!info.email || info.email_verified !== true) {
        this.logger.warn(`Portal sign-in by '${subject}' has no verified email to claim with`);
        return null;
      }

      /*
       * A colleague's address never claims a client's invitation.
       *
       * `bySubject` above catches an employee who has signed in to the internal app; this
       * catches the one it cannot — somebody hired, given a Zitadel account, and not yet
       * seen here, whose address happens to match a pending invitation. Without this they
       * would become that client's portal user, and the row would say so forever.
       */
      if (await this.users.memberWithEmail(info.email)) {
        this.logger.warn(
          `Refused to claim a portal invitation for '${info.email}': that address is a member`,
        );
        return null;
      }
      return await this.portalUsers.claimInvitation(subject, info.email);
    } catch (err) {
      this.logger.warn(`Could not check for a pending invitation: ${(err as Error).message}`);
      return null;
    }
  }
}
