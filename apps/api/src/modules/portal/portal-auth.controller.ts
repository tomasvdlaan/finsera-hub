import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuditService } from '../../core/audit/audit.service.js';
import { Public } from '../../core/auth/public.decorator.js';
import { DB, type Database } from '../../core/db/db.module.js';
import {
  BINDING_COOKIE,
  LOGIN_COOKIE,
  SESSION_COOKIE,
  clearBindingCookie,
  clearLoginCookie,
  clearSessionCookie,
  readCookie,
  setBindingCookie,
  setLoginCookie,
  setSessionCookie,
} from './cookies.js';
import { CSRF_HEADER, CSRF_VALUE } from './portal-auth.guard.js';
import { PortalHostService, type PortalHost } from './portal-host.service.js';
import { PortalIdentityService } from './portal-identity.service.js';
import { LOGIN_STATE_MS, PortalOidcService } from './portal-oidc.service.js';
import { PortalSessionsService, type SessionOwner } from './portal-sessions.service.js';

const CALLBACK_PATH = '/api/portal-auth/callback';

/**
 * Signing in and out of the portal (P1, P2). Every route here is reached by a browser
 * navigation, so the responses are redirects and, on failure, a small HTML page rather
 * than JSON — a client who lands on a JSON error has no button to press.
 *
 * The shape of a login, across hosts:
 *
 *   duce.finsera.nl/api/portal-auth/login?next=/rapporten
 *     → portal.finsera.nl/api/portal-auth/start?host=duce.finsera.nl&next=/rapporten
 *       sets the login cookie (state, nonce, PKCE verifier, where to go) on the auth host
 *     → Zitadel
 *     → portal.finsera.nl/api/portal-auth/callback?code&state
 *       exchanges the code, runs the three gates, decides whose session this is
 *     → duce.finsera.nl/api/portal-auth/complete?t=…     (or, on the auth host itself,
 *       sets the cookie directly and skips this hop)
 *       redeems the one-time ticket, creates the session and the cookie *on this host*
 *     → duce.finsera.nl/rapporten
 *
 * `@Public()` with no guard, which is correct: nobody has a session yet. Every route
 * checks which host it is running on and refuses the wrong one, because the callback
 * on a client host would be a callback Zitadel was never told about.
 */
@Public()
@Controller('portal-auth')
export class PortalAuthController {
  private readonly logger = new Logger(PortalAuthController.name);

  constructor(
    private readonly hosts: PortalHostService,
    private readonly oidc: PortalOidcService,
    private readonly identity: PortalIdentityService,
    private readonly sessions: PortalSessionsService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Step 1: from wherever the browser is, go to the auth host to begin.
   *
   * The nonce set here is what will let this browser, and only this browser, redeem the
   * ticket that comes back. It is set on the host the login started from, which is the host
   * the ticket will be redeemed on — so a ticket somebody else captured is worth nothing to
   * a browser that never asked for one.
   */
  @Get('login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Query('next') next?: string,
  ) {
    const host = await this.requirePortalHost(req);
    const target = new URL(`${req.protocol}://${this.hosts.authHost}/api/portal-auth/start`);
    target.searchParams.set('host', host.host);
    target.searchParams.set('next', safeNext(next));

    if (host.kind === 'client') {
      const nonce = randomBytes(32).toString('base64url');
      setBindingCookie(req, res, nonce, LOGIN_STATE_MS);
      // The hash travels, never the nonce: the auth host has no business holding the value
      // that proves which browser this is.
      target.searchParams.set('b', createHash('sha256').update(nonce).digest('hex'));
    }
    res.redirect(302, target.toString());
  }

  /** Step 2, auth host only: remember the login and send the browser to Zitadel. */
  @Get('start')
  async start(
    @Req() req: Request,
    @Res() res: Response,
    @Query('host') hostParam?: string,
    @Query('next') next?: string,
    @Query('b') binding?: string,
  ) {
    await this.requireAuthHost(req);
    // Only a host this deployment answers for may be a destination; anything else and the
    // callback would become an open redirect with a session attached.
    const target = await this.hosts.resolve(hostParam);
    if (!target) throw new NotFoundException();

    const { authorizeUrl, stateCookie } = await this.oidc.beginLogin({
      redirectUri: this.callbackUri(req),
      targetHost: target.host,
      next: safeNext(next),
      binding: /^[0-9a-f]{64}$/.test(binding ?? '') ? binding! : null,
    });
    setLoginCookie(req, res, stateCookie, LOGIN_STATE_MS);
    res.redirect(302, authorizeUrl);
  }

  /** Step 3, auth host only: Zitadel is back. */
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    await this.requireAuthHost(req);
    clearLoginCookie(req, res);

    if (error || !code) {
      return this.page(res, 400, 'Inloggen mislukt', errorDescription ?? error ?? 'Geen code ontvangen.');
    }

    let result;
    try {
      result = await this.oidc.completeLogin({
        code,
        state: state ?? '',
        stateCookie: readCookie(req, LOGIN_COOKIE),
        redirectUri: this.callbackUri(req),
      });
    } catch (err) {
      return this.page(res, 401, 'Inloggen mislukt', (err as Error).message);
    }

    // The same three gates Phase 7 ran per request: signature+audience, role, and the row
    // that says who this is — a colleague, or a client we invited (P5).
    let identity;
    try {
      identity = await this.identity.identify(result.accessToken);
    } catch (err) {
      /*
       * "No access" and "not configured" are different answers, and conflating them sends
       * whoever is reading the screen to the wrong place.
       *
       * A `ForbiddenException` means the gates worked and this person is not entitled: no
       * invitation, or a revoked one. Anything else means the token could not be checked at
       * all — an opaque access token, a mismatched audience, an unset client id — which is a
       * setting somebody has to change, not a permission. Telling a client "you have no
       * access" when the truth is "this portal is misconfigured" costs an afternoon of
       * looking at the wrong thing, and the person best placed to notice is the one testing.
       */
      const refused = err instanceof ForbiddenException;
      if (!refused) {
        this.logger.error(`Portal sign-in could not be checked: ${(err as Error).message}`);
      }
      return this.page(
        res,
        refused ? 403 : 503,
        refused ? 'Geen toegang' : 'Portaal niet beschikbaar',
        refused
          ? 'U bent ingelogd, maar dit account heeft geen toegang tot het klantportaal.'
          : 'Het klantportaal is op dit moment niet goed ingesteld. Wij zijn op de hoogte; ' +
            'probeer het later opnieuw.',
        // In development, say what actually went wrong. The log has it either way, but the
        // log is in whichever terminal the API happens to be running in, and the person
        // reading this screen while setting the portal up is the person who can fix it.
        // Never in production: a client has no use for it and it names our configuration.
        { logout: refused, detail: process.env.NODE_ENV !== 'production' ? (err as Error).message : undefined },
      );
    }

    const target = await this.hosts.resolve(result.targetHost);
    if (!target) throw new NotFoundException();

    /*
     * A client who signed in at the login host is sent on to their own portal.
     *
     * The login host is nobody's: it resolves without consulting `crm.clients`, so a
     * session there would survive the client being archived or their address being cleared.
     * Rather than making that safe, there is no session there to make safe — the same
     * handoff that carries a login to `duce.finsera.nl` carries this one.
     */
    if (identity.kind === 'client' && target.kind !== 'client') {
      const slug = await this.hosts.slugOf(identity.clientId);
      if (!slug) {
        return this.page(
          res,
          403,
          'Geen portaal',
          'Er is voor u nog geen klantportaal ingericht. Neem contact met ons op.',
          { logout: true },
        );
      }
      const own = await this.hosts.resolve(this.hosts.hostFor(slug));
      if (!own || own.kind !== 'client') throw new NotFoundException();
      const ticket = await this.sessions.issueTicket(
        { kind: 'client', portalUserId: identity.portalUserId, clientId: identity.clientId },
        own.host,
        result.next,
        // No binding: this login began on the login host, so there is no nonce on the
        // client's own host to tie the ticket to.
        null,
      );
      const complete = new URL(`${req.protocol}://${own.host}/api/portal-auth/complete`);
      complete.searchParams.set('t', ticket);
      return res.redirect(302, complete.toString());
    }

    let owner: SessionOwner;
    if (identity.kind === 'staff') {
      // An employee may open any client's portal — but a portal is always somebody's, and
      // the login host is nobody's. Sending them to a client's address is the whole answer.
      if (target.kind !== 'client') {
        return this.page(
          res,
          400,
          'Welk klantportaal?',
          'U bent ingelogd als medewerker. Open het portaal van een klant via het ' +
            'dashboard, bij de klant zelf — dit adres is alleen de inlogpagina.',
        );
      }
      owner = { kind: 'staff', staffUserId: identity.staffUserId, clientId: target.clientId };
    } else {
      if (target.kind === 'client' && target.clientId !== identity.clientId) {
        // Signed in fine, invited fine — to a different client. The one answer that must
        // never be "here is the portal anyway".
        return this.page(
          res,
          403,
          'Niet uw portaal',
          `Dit account heeft toegang tot een ander klantportaal, niet tot ${target.host}.`,
          { logout: true },
        );
      }
      owner = {
        kind: 'client',
        portalUserId: identity.portalUserId,
        clientId: identity.clientId,
      };
    }

    const ticket = await this.sessions.issueTicket(
      owner,
      target.host,
      result.next,
      result.binding,
    );
    const complete = new URL(`${req.protocol}://${target.host}/api/portal-auth/complete`);
    complete.searchParams.set('t', ticket);
    res.redirect(302, complete.toString());
  }

  /** Step 4, client host only: turn the ticket into a session here. */
  @Get('complete')
  async complete(@Req() req: Request, @Res() res: Response, @Query('t') ticket?: string) {
    const host = await this.requirePortalHost(req);
    const binding = readCookie(req, BINDING_COOKIE);
    const redeemed = ticket ? await this.sessions.redeemTicket(ticket, host.host, binding) : null;
    clearBindingCookie(req, res);
    if (!redeemed) {
      return this.page(res, 401, 'Inloggen verlopen', 'Probeer het opnieuw.', { login: true });
    }
    await this.startSession(req, res, redeemed.owner, host);
    res.redirect(302, safeNext(redeemed.next));
  }

  /**
   * Sign out here. Not at Zitadel: a client with their own identity provider should not be
   * signed out of it by us, and Zitadel's own session is theirs to end.
   *
   * Works without a valid session on purpose — an expired cookie still needs clearing —
   * but not without the CSRF header, so a cross-site page cannot sign somebody out.
   */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res() res: Response) {
    const host = await this.requirePortalHost(req);
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      res.status(403).end();
      return;
    }
    const secret = readCookie(req, SESSION_COOKIE);
    if (secret) {
      const session = await this.sessions.resolve(secret);
      if (session) {
        await this.sessions.revoke(session.id);
        await this.db.transaction(async (tx) => {
          await this.audit.record(tx, {
            actorId: session.staffUserId,
            action: 'portal.logout',
            entityType: 'client',
            entityId: session.clientId,
            detail: { portalUserId: session.portalUserId, sessionId: session.id },
          });
        });
      }
    }
    clearSessionCookie(req, res);

    /*
     * And then the session at the identity provider, which is the half that was missing.
     *
     * Ending only ours left the provider's session alive, so the next press of Inloggen
     * returned the same person without asking — a logout button that logs nobody out, and
     * on a shared machine the next person is simply inside somebody's invoices.
     *
     * The browser has to be *sent* there, so this answers with a URL rather than
     * redirecting: the request is a POST carrying the header the API requires on a write,
     * and a redirect on a POST is not something the caller can follow into a navigation.
     * Null when the issuer offers no such endpoint, and the caller then just goes home.
     */
    const back = `${req.protocol}://${this.hosts.authHost}/api/portal-auth/signed-out`;
    res.json({ endSession: await this.oidc.endSessionUrl(back, host.host) });
  }

  /**
   * Where the identity provider sends the browser once it has ended its session.
   *
   * On the login host, because a post-logout URI is exact-match at the provider and
   * registering one per client would be a manual step per onboarding that silently breaks —
   * the same reason the callback lives there (P2). Which portal to return to travels in
   * `state`, and is only honoured if it names a host this deployment actually serves, so it
   * cannot be turned into an open redirect.
   */
  @Get('signed-out')
  async signedOut(@Req() req: Request, @Res() res: Response, @Query('state') state?: string) {
    await this.requireAuthHost(req);
    const target = state ? await this.hosts.resolve(state) : null;
    if (!target) {
      return this.page(res, 200, 'Uitgelogd', 'U bent uitgelogd.', { login: true });
    }
    res.redirect(302, `${req.protocol}://${target.host}/`);
  }

  // ── helpers ──

  private async startSession(req: Request, res: Response, owner: SessionOwner, host: PortalHost) {
    const { id, secret, maxAgeMs } = await this.sessions.create(owner, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(req, res, secret, maxAgeMs);
    await this.db.transaction(async (tx) => {
      await this.audit.record(tx, {
        // A staff login is attributable to a person, so it is attributed: "who opened
        // Duce's portal, and when" is the question P5 creates and this is its answer.
        actorId: owner.staffUserId ?? null,
        action: 'portal.login',
        entityType: 'client',
        entityId: owner.clientId,
        detail: {
          sessionId: id,
          host: host.host,
          ...(owner.kind === 'staff'
            ? { staff: true }
            : { portalUserId: owner.portalUserId }),
        },
      });
    });
  }

  private callbackUri(req: Request): string {
    return `${req.protocol}://${this.hosts.authHost}${CALLBACK_PATH}`;
  }

  private async requirePortalHost(req: Request): Promise<PortalHost> {
    const host = await this.hosts.resolve(req.headers.host);
    // 404, not 403: a guessed hostname gets the same answer as no hostname at all.
    if (!host) throw new NotFoundException();
    return host;
  }

  private async requireAuthHost(req: Request): Promise<void> {
    const host = await this.requirePortalHost(req);
    if (host.kind !== 'auth') throw new NotFoundException();
  }

  /** A plain page for a browser that has nowhere else to go. */
  private page(
    res: Response,
    status: number,
    title: string,
    body: string,
    actions: { login?: boolean; logout?: boolean; detail?: string } = {},
  ) {
    const buttons = [
      actions.login ? `<p><a href="/api/portal-auth/login">Opnieuw inloggen</a></p>` : '',
      actions.logout
        ? // Signing out here ends the session at the identity provider too, so the next
          // attempt asks who you are — which is what makes this a way out of the wrong
          // account rather than a button that returns you to the same refusal.
          `<form method="post" action="/api/portal-auth/logout" onsubmit="fetch('/api/portal-auth/logout',{method:'POST',headers:{'X-Requested-With':'portal'}}).then(r=>r.json()).then(b=>location.replace(b.endSession||'/')).catch(()=>location.replace('/'));return false"><button>Uitloggen</button></form>`
        : '',
    ].join('');
    res
      .status(status)
      .type('html')
      .setHeader('Cache-Control', 'no-store')
      .send(
        `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — Finsera</title>` +
          `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222">` +
          `<h1 style="font-size:1.25rem">${escape(title)}</h1><p>${escape(body)}</p>${buttons}` +
          (actions.detail
            ? `<pre style="margin-top:2rem;padding:.75rem;background:#f4f4f5;border-radius:.375rem;` +
              `white-space:pre-wrap;font-size:.8rem;color:#555">${escape(actions.detail)}\n\n` +
              `(alleen zichtbaar in development)</pre>`
            : '') +
          `</body></html>`,
      );
  }
}

/**
 * Where to go after login: a path on this host, and nothing that could be read as a URL.
 * `//evil.example` is a protocol-relative URL, and so is `/\evil.example` in some browsers.
 */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.length > 2000) return '/';
  if (next.startsWith('/api/')) return '/';
  return next;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
