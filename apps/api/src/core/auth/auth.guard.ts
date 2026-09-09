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
import { rolesFrom } from './roles.js';
import { IS_PUBLIC } from './public.decorator.js';
import { UserService } from './user.service.js';
import { ZitadelTokens } from './zitadel.tokens.js';

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
    private readonly tokens: ZitadelTokens,
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
    /*
     * The signature, the issuer and the audience are `ZitadelTokens`; what the token means
     * is this method.
     *
     * Never `|| undefined` on the audience: an unset one would skip the check entirely,
     * which is the failure that looks like everything working. `onModuleInit` refuses to
     * boot without it, and the verifier refuses to run without it — two locks on the one
     * check that separates an internal token from a client's.
     */
    const payload = await this.tokens.verify(token, {
      audience: this.audience,
      application: 'the internal application',
    });

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
