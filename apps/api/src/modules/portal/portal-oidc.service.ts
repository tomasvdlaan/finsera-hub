import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

/** How long a login may take between "Inloggen" and the callback. */
export const LOGIN_STATE_MS = 10 * 60 * 1000;

/** What `beginLogin` hands the controller: where to send the browser, and what to remember. */
export interface LoginStart {
  authorizeUrl: string;
  /** Signed; goes in the login cookie on the auth host. */
  stateCookie: string;
}

/** What survived the round trip: a verified access token and where the browser was going. */
export interface LoginResult {
  accessToken: string;
  targetHost: string;
  next: string;
  /** The hash of the nonce the target host handed the browser, if the login began there. */
  binding: string | null;
}

/**
 * The OIDC leg of a portal login, done by the server (P1: "backend for frontend").
 *
 * Phase 7 ran Authorization Code + PKCE inside the SPA with `oidc-client-ts`, and the access
 * token lived in `sessionStorage`. This does the same exchange from here: the browser sees
 * an authorize URL and a callback, and never the token. The Zitadel application can then be
 * confidential — `ZITADEL_PORTAL_CLIENT_SECRET` — though PKCE is kept either way, so a
 * public application still works and the secret is defence in depth rather than the only
 * thing binding the code to us.
 *
 * The in-flight state (state, nonce, PKCE verifier, where to go afterwards) is a signed
 * JWT in a cookie on the auth host. Signed rather than stored: there is nothing to look up
 * and nothing to sweep, and it cannot be forged without `PORTAL_SESSION_SECRET`. The
 * verifier is in it, which is fine — the cookie is HttpOnly and path-scoped to the auth
 * routes, and the code it protects is single-use at Zitadel.
 */
@Injectable()
export class PortalOidcService implements OnModuleInit {
  private readonly logger = new Logger(PortalOidcService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  /** undefined = not looked up yet; null = the issuer offers none. */
  private endSession?: string | null;
  /** Random per boot when unset outside production — a login then survives until restart. */
  private ephemeralSecret?: Uint8Array;

  private get issuer() {
    return process.env.ZITADEL_ISSUER ?? '';
  }
  private get clientId() {
    return process.env.ZITADEL_PORTAL_CLIENT_ID ?? '';
  }
  private get clientSecret() {
    return process.env.ZITADEL_PORTAL_CLIENT_SECRET ?? '';
  }

  private get signingKey(): Uint8Array {
    const configured = process.env.PORTAL_SESSION_SECRET;
    if (configured) return new TextEncoder().encode(configured);
    this.ephemeralSecret ??= randomBytes(32);
    return this.ephemeralSecret;
  }

  onModuleInit(): void {
    if (!process.env.PORTAL_SESSION_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        // A random secret in production would work right up to the first restart, at which
        // point every login in flight fails with a message nobody can act on.
        throw new Error('PORTAL_SESSION_SECRET is not set — generate one: openssl rand -base64 32');
      }
      this.logger.warn('PORTAL_SESSION_SECRET is not set; using a per-boot secret (development only)');
    }
    if (this.clientId && !this.clientSecret) {
      this.logger.log('Portal Zitadel application is public (no ZITADEL_PORTAL_CLIENT_SECRET); using PKCE only');
    }
    void this.checkApplicationExists();
  }

  /**
   * Where to send a browser to end the session at the identity provider, or null.
   *
   * Read from the issuer's own discovery document rather than assumed, and cached for the
   * life of the process: an issuer that advertises no `end_session_endpoint` gets no
   * redirect at all, which is why logging out still works — locally — against one.
   *
   * `client_id` stands in for `id_token_hint`. Keeping an id token on the session purely to
   * hand it back at logout would mean storing a bundle of the person's claims for the life
   * of the session, to save a click; without either, the provider has no idea which
   * application is asking and refuses the return trip.
   */
  async endSessionUrl(postLogoutRedirectUri: string, state: string): Promise<string | null> {
    const endpoint = await this.endSessionEndpoint();
    if (!endpoint || !this.clientId) return null;
    const url = new URL(endpoint);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async endSessionEndpoint(): Promise<string | null> {
    if (this.endSession !== undefined) return this.endSession;
    try {
      const res = await fetch(`${this.issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await res.json()) as { end_session_endpoint?: string };
      this.endSession = body.end_session_endpoint ?? null;
      if (!this.endSession) {
        this.logger.warn(`${this.issuer} advertises no end_session_endpoint; logout stays local`);
      }
    } catch (err) {
      // Not cached as null: a network blip at the wrong moment should not turn logout into
      // a local-only affair for the rest of the process's life.
      this.logger.warn(`Could not read the issuer's configuration: ${(err as Error).message}`);
      return null;
    }
    return this.endSession;
  }

  /**
   * Does the portal application this instance is configured with actually exist?
   *
   * Worth asking at boot because the failure is otherwise invisible from here and cryptic
   * from there: everything on this side works — the redirect is built, the state cookie is
   * set — and the client lands on a Zitadel page reading
   * `{"error":"invalid_request","error_description":"Errors.App.NotFound"}`, which names
   * neither the setting nor the side that is wrong. A deleted application and a mistyped id
   * are indistinguishable from a portal that is simply broken.
   *
   * Detached and non-fatal, unlike the secret check above. Zitadel being unreachable for a
   * moment at boot is not a reason to refuse to start, and a wrong id is not something that
   * changes while running — so this is a loud warning once, not a gate. Only the two
   * responses that mean "no such application" are treated as an answer; anything else,
   * including a network failure, is left alone rather than guessed at.
   */
  private async checkApplicationExists(): Promise<void> {
    if (!this.issuer || !this.clientId) return;
    try {
      const url = new URL(`${this.issuer}/oauth/v2/authorize`);
      url.searchParams.set('client_id', this.clientId);
      url.searchParams.set('response_type', 'code');
      // A placeholder: Zitadel resolves the application before it looks at this, so an
      // unregistered value still produces the answer we are asking for.
      url.searchParams.set('redirect_uri', 'http://localhost/__probe');
      url.searchParams.set('scope', 'openid');

      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      if (res.status !== 400) return;
      const body = (await res.json().catch(() => ({}))) as { error_description?: string; error?: string };
      const missing =
        body.error_description?.includes('App.NotFound') || body.error === 'invalid_client';
      if (!missing) return;

      this.logger.error(
        `ZITADEL_PORTAL_CLIENT_ID=${this.clientId} is not an application in ${this.issuer}. ` +
          'Portal sign-in will fail at Zitadel with "Errors.App.NotFound". Copy the Client ID ' +
          'from the portal application in the Zitadel console — and if it no longer exists, ' +
          'create one and register its redirect URI ' +
          `(${process.env.PORTAL_AUTH_HOST ? `https://${process.env.PORTAL_AUTH_HOST}` : 'http://localhost:5174'}/api/portal-auth/callback).`,
      );
    } catch {
      // Unreachable at boot says nothing about whether the application exists.
    }
  }

  /** Build the authorize redirect and the cookie that will recognise its answer. */
  async beginLogin(input: {
    redirectUri: string;
    targetHost: string;
    next: string;
    binding?: string | null;
  }): Promise<LoginStart> {
    if (!this.issuer || !this.clientId) {
      throw new UnauthorizedException('Portal login is not configured');
    }
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const stateCookie = await new SignJWT({
      state,
      nonce,
      verifier,
      host: input.targetHost,
      next: input.next,
      binding: input.binding ?? null,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor((Date.now() + LOGIN_STATE_MS) / 1000))
      .sign(this.signingKey);

    const url = new URL(`${this.issuer}/oauth/v2/authorize`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    // Same scope the SPA asked for: the roles claim is what authorises when grants work.
    url.searchParams.set('scope', 'openid profile email urn:zitadel:iam:org:project:roles');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { authorizeUrl: url.toString(), stateCookie };
  }

  /**
   * Turn the callback's `code` into a verified access token.
   *
   * Three checks before the token is trusted: the state matches the cookie (so the callback
   * answers a login this server started), the code exchange succeeds with our verifier and
   * secret, and the ID token verifies against the issuer's keys with our audience and the
   * nonce we chose. The access token is then handed to `PortalIdentityService`, which runs
   * the same audience/role/invitation gates Phase 7 ran on every request.
   */
  async completeLogin(input: {
    code: string;
    state: string;
    stateCookie: string | undefined;
    redirectUri: string;
  }): Promise<LoginResult> {
    if (!input.stateCookie) throw new UnauthorizedException('Login expired — start again');

    let claims: {
      state: string;
      nonce: string;
      verifier: string;
      host: string;
      next: string;
      binding: string | null;
    };
    try {
      const { payload } = await jwtVerify(input.stateCookie, this.signingKey, {
        algorithms: ['HS256'],
      });
      claims = payload as unknown as typeof claims;
    } catch {
      throw new UnauthorizedException('Login expired — start again');
    }
    if (!input.state || claims.state !== input.state) {
      throw new UnauthorizedException('Login state mismatch — start again');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: claims.verifier,
      client_id: this.clientId,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.clientSecret) {
      headers.Authorization =
        'Basic ' +
        Buffer.from(
          `${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`,
        ).toString('base64');
    }

    let tokens: { access_token?: string; id_token?: string; error?: string; error_description?: string };
    try {
      const res = await fetch(`${this.issuer}/oauth/v2/token`, { method: 'POST', headers, body });
      tokens = (await res.json()) as typeof tokens;
      if (!res.ok || !tokens.access_token || !tokens.id_token) {
        this.logger.warn(`Token exchange failed: ${tokens.error ?? res.status} ${tokens.error_description ?? ''}`);
        throw new Error('exchange failed');
      }
    } catch {
      throw new UnauthorizedException('Sign-in could not be completed — start again');
    }

    try {
      this.jwks ??= createRemoteJWKSet(new URL(`${this.issuer}/oauth/v2/keys`));
      const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: this.issuer,
        audience: this.clientId,
      });
      if (payload.nonce !== claims.nonce) throw new Error('nonce mismatch');
    } catch (err) {
      this.logger.warn(`ID token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Sign-in could not be verified — start again');
    }

    return {
      accessToken: tokens.access_token,
      targetHost: claims.host,
      next: claims.next,
      binding: claims.binding ?? null,
    };
  }
}
