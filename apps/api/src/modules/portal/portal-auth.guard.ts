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
import { PortalUsersService } from './portal-users.service.js';
import type { PortalVisitor } from './portal.projection.js';

declare module 'express' {
  interface Request {
    visitor?: PortalVisitor;
  }
}

/**
 * Verifies a token from the PORTAL Zitadel project and resolves it to a visitor.
 *
 * Two separate things have to be true, and conflating them is the classic way this goes
 * wrong:
 *
 *   1. The token is genuine — signed by Zitadel, not expired. Standard.
 *   2. The token was issued **for the portal**. This is the one that matters. Both
 *      projects live in the same Zitadel instance and share an issuer, so the signature
 *      alone does not distinguish an internal token from a portal one. The audience does.
 *
 * Without (2), an internal user's token would sail through this guard and get resolved
 * against `portal.users` — and the entire separation would rest on that lookup failing.
 * With (2), an internal token is refused before anyone asks who it belongs to, and a
 * portal token is likewise refused by the internal guard, which checks its own audience.
 *
 * That is why `audience` below is required rather than optional. The internal guard
 * tolerates an empty audience (`audience || undefined`), which is defensible for a single
 * trusted tenant and indefensible here: an unset environment variable would silently turn
 * the check off, which is the failure that looks like everything working.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(PortalAuthGuard.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly portalUsers: PortalUsersService) {}

  private get issuer() {
    return process.env.ZITADEL_ISSUER ?? '';
  }

  /** The portal project's client id — never the internal one. */
  private get audience() {
    return process.env.ZITADEL_PORTAL_CLIENT_ID ?? '';
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
        'ZITADEL_PORTAL_CLIENT_ID equals ZITADEL_CLIENT_ID. The portal must be a ' +
          'separate Zitadel project, or an internal token authenticates a client.',
      );
    }
    if (!this.audience) {
      this.logger.warn(
        'ZITADEL_PORTAL_CLIENT_ID is not set — the portal will refuse every request. ' +
          'Set it to the portal project’s client id (see .env.example).',
      );
      return;
    }
    this.logger.log(`Portal auth configured for audience ${this.audience}`);
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

    return this.portalUsers.resolveFromSubject(payload.sub!);
  }
}
