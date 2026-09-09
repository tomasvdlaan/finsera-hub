import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * One key set, and one way to check a token against it.
 *
 * Three places verified Zitadel tokens and each built its own `createRemoteJWKSet` — the
 * internal guard, the portal's login-time identity check, and the portal's OIDC code
 * exchange. Three key sets against one issuer means three independent caches, three fetches
 * when Zitadel rotates a signing key, and three chances for the checks either side of them to
 * drift. `AuthModule` already goes out of its way to keep the *guard* a single instance for
 * exactly this reason ("two guards would mean two JWKS caches"); this extends that to
 * everywhere a token is verified.
 *
 * What is deliberately NOT here: what a verified token means. The internal guard resolves one
 * to an `Actor` and may provision a colleague; the portal resolves one to a client or a staff
 * viewer and may never provision anybody; the OIDC service only wants the nonce back. Those
 * are three different authorisation decisions with three different blast radii, and they stay
 * in their own files. This checks the signature, the issuer and the audience, and stops.
 *
 * The audience is required rather than optional, and that is the one behaviour change worth
 * naming: `jwtVerify` with `audience: undefined` skips the check entirely, so an unset
 * environment variable would silently accept every token this Zitadel instance has ever
 * issued — a client's portal token included. Both existing callers already refuse before they
 * get here. This makes it impossible for a fourth to forget.
 */
@Injectable()
export class ZitadelTokens {
  private readonly logger = new Logger(ZitadelTokens.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  // Read at call time, not construction: a provider can be instantiated before config loads.
  private get issuer(): string {
    return process.env.ZITADEL_ISSUER ?? '';
  }

  /**
   * Verify a token and hand back its claims.
   *
   * `application` names which Zitadel application the token should have come from — the
   * internal one, the portal one — and appears in the diagnostics, because both failures below
   * are settings somebody has to go and change and neither says which side is wrong on its own.
   */
  async verify(
    token: string,
    options: { audience: string; application: string },
  ): Promise<JWTPayload> {
    if (!this.issuer) {
      throw new UnauthorizedException('ZITADEL_ISSUER is not configured');
    }
    if (!options.audience) {
      // Never reached from either caller — both check first, with a message that names their
      // own variable. This is the floor under that, so the failure is a refusal rather than a
      // check that quietly stopped happening.
      this.logger.error(
        `Refusing to verify a token for ${options.application} with no audience configured`,
      );
      throw new UnauthorizedException('Authentication is not configured');
    }

    /*
     * A JWT has three segments.
     *
     * Zitadel issues opaque (encrypted, five-segment) access tokens by default, and those
     * cannot be validated offline at all. Left as a generic 401 this costs an afternoon,
     * because everything else about the setup looks right — so it names the setting.
     */
    if (token.split('.').length !== 3) {
      this.logger.error(
        `Received an opaque access token for ${options.application}. Set that application’s ` +
          'Auth Token Type to "JWT" (Token Settings) so it can be validated via JWKS.',
      );
      throw new UnauthorizedException('Opaque access token — expected a JWT');
    }

    try {
      this.jwks ??= createRemoteJWKSet(new URL(`${this.issuer}/oauth/v2/keys`));
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: options.audience,
      });
      return payload;
    } catch (err) {
      // The reason is logged and not returned: which of signature, issuer, audience or expiry
      // failed is useful to us and is a map of the checks to whoever sent the token.
      this.logger.warn(`Token for ${options.application} rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * The issuer's own answer about the holder of this token.
   *
   * A server-to-server call to the issuer, authenticated with the caller's access token, so
   * what comes back is exactly as trustworthy as a claim inside the token — which is why the
   * roles helper reads either shape. It matters on this instance, where the access token
   * carries only the standard claims and the roles arrive here instead.
   *
   * Null on any failure, never a throw. Both callers treat an unreachable userinfo as "carry
   * on with what the token said" (provisioning) or "this sign-in cannot claim an invitation"
   * (the portal), and neither is an error to raise at the person signing in.
   *
   * Returns the raw claim bag on purpose. What may be *done* with it differs sharply — the
   * portal will only claim an invitation on an address Zitadel says is verified, and the
   * internal path has no such rule — so each caller keeps its own reading of these claims
   * where that rule is visible, instead of a shared shape that implies they are the same.
   */
  async userInfo(accessToken: string): Promise<Record<string, unknown> | null> {
    if (!this.issuer) return null;
    try {
      const res = await fetch(`${this.issuer}/oidc/v1/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`userinfo returned ${res.status}`);
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`userinfo unreachable: ${(err as Error).message}`);
      return null;
    }
  }
}
