import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuditService } from '../../core/audit/audit.service.js';
import type { Database } from '../../core/db/db.module.js';
import { SESSION_COOKIE, readCookie } from './cookies.js';
import type { PortalHostService } from './portal-host.service.js';
import type { PortalPagesService } from './portal-pages.service.js';
import type { PortalSessionsService } from './portal-sessions.service.js';

/** Long enough for a cold serverless start, short enough that a hung origin is not our problem. */
const TIMEOUT_MS = 10_000;
/** A report is a page. Anything larger than this is not one, and we are not a CDN. */
const MAX_BYTES = 20 * 1024 * 1024;

/** Headers that describe one hop and must not be forwarded across another. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** What comes back to the browser, and nothing else — an allow-list, not a blocklist. */
const PASS_THROUGH = ['content-type', 'content-length', 'etag', 'last-modified'];

export interface ProxyDeps {
  hosts: PortalHostService;
  sessions: PortalSessionsService;
  pages: PortalPagesService;
  audit: AuditService;
  db: Database;
}

/**
 * Custom content, served at the client's own address.
 *
 * `duce.finsera.nl/rapportage-q3` is a report Finsera built and deployed to Vercel. The
 * browser is never told that: this fetches it server-side and returns the bytes, so the
 * deployment URL stays out of the page, the Vercel project keeps its protection on, and
 * who may read it becomes the same question as who may read an invoice — the portal
 * session, and the client it belongs to.
 *
 * Middleware rather than a controller because the path space is the client's, not ours:
 * `/rapportage-q3/assets/index-abc.js` has no route to declare, and which first segments
 * exist is a row in a table rather than a decorator.
 *
 * **Order matters.** This runs before the SPA is served, so a page shadows an SPA route of
 * the same name — which is why `PortalPagesService` keeps a reserved list. It runs after
 * `/api/*`, which it never touches.
 *
 * **A signed-out visitor is redirected, not refused.** The whole point of the feature is a
 * link somebody can send in an email, so arriving at one without a session has to start a
 * login that comes back to the same URL.
 */
export function portalProxy(deps: ProxyDeps) {
  const logger = new Logger('PortalProxy');

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path === '/api') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let host;
    try {
      host = await deps.hosts.resolve(req.headers.host);
    } catch (err) {
      return next(err);
    }
    // Pages belong to a client, so they exist only on a client's own host. The login host
    // is nobody's, and `hub` is not a portal at all.
    if (!host || host.kind !== 'client') return next();

    const segments = req.path.split('/').filter(Boolean).map(decodeSegment);
    const slug = segments[0];
    if (!slug) return next();

    /*
     * `..` never reaches the upstream URL.
     *
     * Express does not normalise the request line, `encodeURIComponent('..')` is `..`
     * because dots are unreserved, and WHATWG URL collapses the segments when `fetch`
     * parses the string — so `/rapport/../../elders/` would have fetched an arbitrary path
     * on the source origin **with the bypass secret attached**. Where several clients'
     * reports share one deployment, that is a cross-client read of exactly the content this
     * proxy exists to gate.
     *
     * Refused rather than normalised: a request containing `..` is not a page anyone
     * legitimately asked for, and silently rewriting it would hide whatever produced it.
     */
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      return res.status(400).type('text').send('Ongeldig adres.');
    }

    let page;
    try {
      page = await deps.pages.find(host.clientId, slug);
    } catch (err) {
      return next(err);
    }
    if (!page) return next();

    // Only now is a session required — asking earlier would mean an unknown path told a
    // stranger whether they were signed in.
    const secret = readCookie(req, SESSION_COOKIE);
    const session = secret ? await deps.sessions.resolve(secret) : null;
    if (!session || session.clientId !== host.clientId) {
      const next_ = encodeURIComponent(req.originalUrl);
      return res.redirect(302, `/api/portal-auth/login?next=${next_}`);
    }

    const isRoot = segments.length === 1;
    if (isRoot && !req.path.endsWith('/')) {
      // The trailing slash is load-bearing: without it every relative URL inside the report
      // resolves one level too high, against the portal instead of against the page.
      //
      // Built from the parsed slug rather than from `req.path`, because `//rapport` also
      // arrives here — and echoing that back would be a protocol-relative Location, which
      // is a redirect to another host rather than to a path.
      return res.redirect(301, `/${slug}/${req.url.slice(req.path.length)}`);
    }

    if (isRoot) {
      // Audited like every other portal read. Assets under the page are not: one line per
      // report opened is a record somebody can read, one line per file is noise.
      try {
        await deps.db.transaction(async (tx) => {
          await deps.audit.record(tx, {
            actorId: session.staffUserId,
            action: 'portal.read',
            entityType: 'client',
            entityId: host.clientId,
            detail: {
              read: 'page',
              subject: slug,
              email: session.email,
              ...(session.kind === 'staff'
                ? { staff: true }
                : { portalUserId: session.portalUserId }),
            },
          });
        });
      } catch (err) {
        // A page that cannot be audited is not served. The audit is the reason a client's
        // content can live here at all, and "we served it but did not record it" is the one
        // outcome that must not be available.
        logger.error(`Refusing '${slug}': audit failed — ${(err as Error).message}`);
        return res.status(503).type('text').send('Even niet beschikbaar. Probeer het zo opnieuw.');
      }
    }

    if (page.kind === 'redirect') {
      // The lossy option, chosen deliberately per page: the browser goes to the real
      // address, which means the client can see it and keep it.
      return res.redirect(302, page.sourceUrl);
    }

    const rest = segments.slice(1).map(encodeURIComponent).join('/');
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const target = underSource(page.sourceUrl, rest, query);
    if (!target) {
      // The segment check above should have caught everything that gets here, so this is
      // the assertion behind it rather than a second rule: whatever URL is about to be
      // fetched has to still be inside the page's own path, however it was spelled.
      logger.warn(`Refusing a request for '${slug}' that resolves outside its source`);
      return res.status(400).type('text').send('Ongeldig adres.');
    }

    try {
      await serve(req, res, target, page, slug, deps, logger);
    } catch (err) {
      if (res.headersSent) {
        // Mid-stream: the browser already has a status and some bytes, so there is no error
        // page to send. Destroying the socket is what tells it the body is incomplete.
        logger.warn(`Proxy stream for '${slug}' failed: ${(err as Error).message}`);
        res.destroy();
        return;
      }
      logger.warn(`Proxy for '${slug}' failed: ${(err as Error).message}`);
      res
        .status(502)
        .type('text')
        .send('Deze pagina is op dit moment niet beschikbaar.');
    }
  };
}

async function serve(
  req: Request,
  res: Response,
  target: string,
  page: { sourceUrl: string; bypassSecretEnc: string | null },
  slug: string,
  deps: ProxyDeps,
  logger: Logger,
) {
  const secret = deps.pages.secretFor(page);
  const upstream = await fetch(target, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    // Never automatic. A followed redirect is a second request to an address nobody
    // checked, which is the shape of every SSRF that got past a URL allow-list.
    redirect: 'manual',
    headers: {
      // Vercel's Protection Bypass for Automation. With it the deployment can keep
      // protection on and still answer us — and only us, since the secret never leaves here.
      ...(secret ? { 'x-vercel-protection-bypass': secret } : {}),
      accept: req.headers.accept ?? '*/*',
      ...(req.headers['accept-language']
        ? { 'accept-language': String(req.headers['accept-language']) }
        : {}),
      'user-agent': 'Finsera-Portal/1.0',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location');
    const rewritten = location ? sameOriginPath(location, page.sourceUrl, slug) : null;
    if (!rewritten) {
      logger.warn(`Upstream for '${slug}' redirected off-origin to ${location ?? '(none)'}`);
      throw new Error('upstream redirected off-origin');
    }
    res.redirect(upstream.status === 301 ? 301 : 302, rewritten);
    return;
  }

  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value && !HOP_BY_HOP.has(name)) res.setHeader(name, value);
  }
  // Never in a shared cache: this is one client's report, served from a URL that differs
  // from another client's only by hostname. `set-cookie` is dropped by omission — the
  // allow-list above is why there is no line here removing it.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  /*
   * A report runs on the client's own origin, so it must not be able to *act* as them.
   *
   * HttpOnly stops a script reading the session cookie; it does nothing to stop a script
   * using it. Without this, any code inside a proxied report — a compromised deployment, a
   * dependency in its bundle, an analytics snippet somebody pasted in — could POST to
   * `/api/portal/quotes/<id>/accept` with the client's own session and accept a quote on
   * their behalf. That is precisely the boundary `@CurrentVisitor()` exists to hold, and a
   * same-origin fetch walks around it.
   *
   * `connect-src 'none'` is what closes it. `form-action 'none'` closes the same hole for a
   * submitted form. The rest keeps the report self-contained: its own assets (which we
   * proxy, so they are same-origin), inline script and style because report builds inline
   * both, and data: images because charts are drawn that way.
   */
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join('; '),
  );
  // Deliberately no X-Frame-Options: a report may legitimately be embedded, and the session
  // cookie is SameSite=Lax, so a cross-site frame gets the login redirect rather than data.
  res.status(upstream.status);

  if (req.method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }

  const type = upstream.headers.get('content-type') ?? '';
  if (/^text\/html|^text\/css/i.test(type)) {
    // Read whole and rewrite. Bounded by the same cap as everything else, and the only
    // case where the body is buffered — a stylesheet cannot be rewritten in pieces.
    const buffer = await readCapped(upstream.body, MAX_BYTES);
    const body = rewriteRootUrls(buffer.toString('utf8'), slug);
    res.removeHeader('Content-Length');
    res.end(body);
    return;
  }

  let seen = 0;
  const source = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > MAX_BYTES) source.destroy(new Error(`over ${MAX_BYTES} bytes`));
  });
  await pipeline(source, res);
}

async function readCapped(body: ReadableStream<Uint8Array>, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let seen = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.length;
    if (seen > cap) {
      await reader.cancel();
      throw new Error(`over ${cap} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Root-absolute URLs, moved under the page.
 *
 * A build that emits `/assets/index-abc.js` is asking for a file at the root of the host —
 * which, on a portal host, is the portal, not the report. The real fix is a relative base
 * in the report's own build (`base: './'` in Vite, `assetPrefix` in Next), and the admin
 * page says so. This is the fallback for the ones already built.
 *
 * Text substitution, and honest about it: it will not catch a URL a script assembles at
 * runtime, and it does not try. `//` is skipped because that is a protocol-relative URL to
 * another host, not a path.
 */
export function rewriteRootUrls(body: string, slug: string): string {
  return body
    .replace(/\b(src|href|action|poster|data-src)=(["'])\/(?!\/)/gi, `$1=$2/${slug}/`)
    .replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1/${slug}/`);
}

/**
 * An upstream redirect, kept inside the page — or refused.
 *
 * Vercel redirects for ordinary reasons (a missing trailing slash, mostly), so refusing
 * every redirect would break real deployments. Following one to another origin would hand
 * the bypass secret to whoever that origin is, so only a redirect that stays on the source
 * origin is translated back into a path under this page.
 */
export function sameOriginPath(location: string, sourceUrl: string, slug: string): string | null {
  const source = new URL(sourceUrl);
  let target: URL;
  try {
    target = new URL(location, source);
  } catch {
    return null;
  }
  if (target.origin !== source.origin) return null;
  const base = source.pathname.replace(/\/$/, '');
  if (!target.pathname.startsWith(base)) return null;
  const rest = target.pathname.slice(base.length);
  return `/${slug}${rest}${target.search}`;
}

/**
 * The URL to fetch, or null if it would leave the page's own path.
 *
 * `sameOriginPath` already enforces exactly this for an upstream *redirect*; the request
 * path deserves the same check, and having both means the rule is stated once per direction
 * rather than assumed on the way in.
 */
export function underSource(sourceUrl: string, rest: string, query: string): string | null {
  const source = new URL(sourceUrl);
  const base = source.pathname.replace(/\/$/, '');
  let target: URL;
  try {
    target = new URL(`${base}/${rest}${query}`, source);
  } catch {
    return null;
  }
  if (target.origin !== source.origin) return null;
  if (target.pathname !== base && !target.pathname.startsWith(`${base}/`)) return null;
  return target.toString();
}

/** A path segment that a malformed escape cannot turn into an exception. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
