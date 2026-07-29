import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PORTAL_ROLE, hasRole } from '../../core/auth/roles.js';
import { PortalUsersService } from './portal-users.service.js';
import type { PortalVisitor } from './portal.projection.js';

declare module 'express' {
  interface Request {
    visitor?: PortalVisitor;
  }
}

/**
 * Verifies a token from the portal application and resolves it to a visitor.
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
 * `audience` is still required rather than optional. The internal guard tolerates an empty
 * one (`audience || undefined`), defensible for a single trusted tenant and indefensible
 * here: an unset variable would silently turn a check off, which is the failure that looks
 * like everything working.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(PortalAuthGuard.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly portalUsers: PortalUsersService) {}

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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers.authorization?.replace(/^Bearer /i, '');
    if (!token) throw new UnauthorizedException('Missing bearer token');

    req.visitor = await this.verifyToken(token);
    // No `req.actor`: a portal request must never satisfy an internal guard, and leaving
    // that field unset is what makes an accidentally-shared controller fail closed.
    return true;
  }

  async verifyToken(token: string): Promise<PortalVisitor> {
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

    // The audience above is necessary and not sufficient: Zitadel will issue a token
    // carrying an audience the holder has no grant for, so `aud` restates the request
    // rather than proving authorisation. The role comes from a grant, so it does.
    if (this.roleCheckEnabled && !hasRole(payload, PORTAL_ROLE)) {
      this.logger.warn(
        `Portal token rejected: subject '${payload.sub}' has no '${PORTAL_ROLE}' role`,
      );
      throw new UnauthorizedException('Invalid token');
    }

    // Third gate, and the only one that says *whose* data this is: an invitation we wrote.
    return this.portalUsers.resolveFromSubject(payload.sub!);
  }
}
