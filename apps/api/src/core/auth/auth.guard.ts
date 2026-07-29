import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from '@platform/contracts';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { rolesFrom } from './roles.js';
import { IS_PUBLIC } from './public.decorator.js';
import { UserService } from './user.service.js';

/**
 * Validates the Zitadel-issued JWT against the issuer's JWKS, then resolves it to a
 * platform Actor (JIT-provisioning on first login).
 *
 * Applied globally — endpoints are authenticated unless explicitly marked @Public().
 * Defaulting to closed is the point: forgetting a decorator locks a route down rather
 * than exposing it.
 */
@Injectable()
export class AuthGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(AuthGuard.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  // Read at call time, not construction: guard instantiation can precede config load.
  private get issuer() {
    return process.env.ZITADEL_ISSUER ?? '';
  }
  private get audience() {
    return process.env.ZITADEL_CLIENT_ID ?? '';
  }

  /** Fail fast — a deploy missing its issuer should not boot and 401 every request. */
  onModuleInit(): void {
    if (!this.issuer) {
      throw new Error('ZITADEL_ISSUER is not set — check .env (see .env.example).');
    }
    // Required since the portal introduced a second audience into the same Zitadel
    // instance. An empty audience was defensible when every token this issuer minted was
    // an internal one; now it would mean this guard accepts a *client's* portal token,
    // and the only thing left between that client and the internal API would be
    // provisioning refusing to create them a user.
    if (!this.audience) {
      throw new Error(
        'ZITADEL_CLIENT_ID is not set. It is what stops a client portal token from ' +
          'authenticating against the internal API — see decision log G4.',
      );
    }
    this.logger.log(`Auth configured for issuer ${this.issuer}`);
  }

  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers.authorization?.replace(/^Bearer /i, '');
    if (!token) throw new UnauthorizedException('Missing bearer token');

    req.actor = await this.verifyToken(token);
    return true;
  }

  /**
   * Verify a token and resolve who it belongs to.
   *
   * Public because the live meeting socket needs it: a WebSocket has no Authorization
   * header, so the token arrives as a query parameter — but it is then checked by exactly
   * this code. A second verification path is how one of them ends up weaker.
   */
  async verifyToken(token: string): Promise<Actor> {
    if (!this.issuer) {
      throw new UnauthorizedException('ZITADEL_ISSUER is not configured');
    }

    // A JWT has 3 segments. Zitadel defaults to opaque (encrypted, 5-segment) access
    // tokens, which cannot be validated offline — surface that as a fixable config
    // problem rather than an indistinguishable 401.
    if (token.split('.').length !== 3) {
      this.logger.error(
        'Received an opaque access token. Set the Zitadel application’s ' +
          'Auth Token Type to "JWT" (Token Settings) so it can be validated via JWKS.',
      );
      throw new UnauthorizedException('Opaque access token — expected a JWT');
    }

    let payload: JWTPayload;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(`${this.issuer}/oauth/v2/keys`));
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        // Never `|| undefined`: an unset audience would skip the check entirely, which
        // is the failure that looks like everything working. onModuleInit refuses to boot
        // without it, so by here it is always set.
        audience: this.audience,
      }));
    } catch (err) {
      this.logger.warn(`Token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }

    return this.users.resolveFromClaims(
      {
        sub: payload.sub!,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        preferred_username: payload.preferred_username as string | undefined,
        roles: rolesFrom(payload),
      },
      token,
    );
  }
}
