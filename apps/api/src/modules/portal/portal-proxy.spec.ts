import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { isPrivate } from './portal-pages.service.js';
import { portalProxy, rewriteRootUrls, sameOriginPath, underSource } from './portal-proxy.js';

const CLIENT = 'c-duce';
const PAGE = {
  id: 'p-1',
  clientId: CLIENT,
  slug: 'rapportage-q3',
  title: 'Rapportage Q3',
  kind: 'proxy',
  sourceUrl: 'https://rapportage-q3-duce.vercel.app',
  bypassSecretEnc: 'enc',
  enabled: true,
};

/** A response object that records what was done to it, rather than a real socket. */
function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    redirected: undefined as { status: number; to: string } | undefined,
    headersSent: false,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    removeHeader(name: string) {
      delete this.headers[name.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    end(body?: unknown) {
      if (body !== undefined) this.body = body;
      return this;
    },
    redirect(status: number, to: string) {
      this.redirected = { status, to };
    },
    destroy: vi.fn(),
  };
  return res as unknown as Response & typeof res;
}

function fakeReq(path: string, cookie = 'psid=secret'): Request {
  return {
    path,
    originalUrl: path,
    url: path,
    method: 'GET',
    headers: { host: 'duce.finsera.nl', cookie },
  } as unknown as Request;
}

/** A write, shaped the way the JSON body parser leaves one: stream consumed, `req.body` set. */
function fakeWrite(path: string, body: unknown, method = 'POST'): Request {
  return {
    path,
    originalUrl: path,
    url: path,
    method,
    headers: { host: 'duce.finsera.nl', cookie: 'psid=secret', 'content-type': 'application/json' },
    body,
  } as unknown as Request;
}

function upstream(body: string, headers: Record<string, string>, status = 200) {
  return {
    status,
    ok: status < 400,
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    }),
  } as unknown as Awaited<ReturnType<typeof fetch>>;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    hosts: {
      resolve: vi.fn().mockResolvedValue({
        kind: 'client', host: 'duce.finsera.nl', slug: 'duce', clientId: CLIENT, clientName: 'Duce',
      }),
    },
    sessions: {
      resolve: vi.fn().mockResolvedValue({
        id: 's-1', kind: 'client', portalUserId: 'pu-1', staffUserId: null,
        clientId: CLIENT, email: 'finance@duce.nl',
      }),
    },
    pages: {
      find: vi.fn().mockResolvedValue(PAGE),
      secretFor: vi.fn().mockReturnValue('bypass-secret'),
    },
    audit: { record: vi.fn() },
    db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({})) },
    ...overrides,
  } as unknown as Parameters<typeof portalProxy>[0];
}

/**
 * The one place in the platform that fetches somebody else's URL and hands the answer to a
 * client's browser. Every test here is about a boundary rather than about proxying working:
 * whose session, whose host, which upstream, and what comes back with the bytes.
 */
describe('portalProxy', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(upstream('<html></html>', { 'content-type': 'text/html' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves paths that are not a page to the SPA', async () => {
    const next = vi.fn() as NextFunction;
    const d = deps({ pages: { find: vi.fn().mockResolvedValue(null), secretFor: vi.fn() } });
    await portalProxy(d)(fakeReq('/facturen'), fakeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never serves a page on the login host or on hub', async () => {
    const next = vi.fn() as NextFunction;
    const d = deps({ hosts: { resolve: vi.fn().mockResolvedValue({ kind: 'auth', host: 'portal.finsera.nl' }) } });
    await portalProxy(d)(fakeReq('/rapportage-q3/'), fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('sends a signed-out visitor to log in, and back to the same link', async () => {
    // The whole point of the feature is a link somebody can email. Arriving at one without
    // a session has to start a login that returns to it, not produce a 401.
    const d = deps({ sessions: { resolve: vi.fn().mockResolvedValue(null) } });
    const res = fakeRes();
    await portalProxy(d)(fakeReq('/rapportage-q3/', ''), res, vi.fn() as NextFunction);
    expect(res.redirected).toEqual({
      status: 302,
      to: '/api/portal-auth/login?next=%2Frapportage-q3%2F',
    });
  });

  it('refuses a session belonging to another client', async () => {
    const d = deps({
      sessions: {
        resolve: vi.fn().mockResolvedValue({
          id: 's-2', kind: 'client', portalUserId: 'pu-9', staffUserId: null,
          clientId: 'c-someone-else', email: 'them@elsewhere.nl',
        }),
      },
    });
    const res = fakeRes();
    await portalProxy(d)(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    // Sent to log in rather than served: the cookie is for a different portal entirely.
    expect(res.redirected?.to).toContain('/api/portal-auth/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds the trailing slash before fetching anything', async () => {
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3'), res, vi.fn() as NextFunction);
    // Without it every relative URL in the report resolves against the portal root.
    expect(res.redirected).toEqual({ status: 301, to: '/rapportage-q3/' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bypass secret upstream and never downstream', async () => {
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://rapportage-q3-duce.vercel.app/');
    expect((init.headers as Record<string, string>)['x-vercel-protection-bypass']).toBe('bypass-secret');
    expect(init.redirect).toBe('manual');
    // Nothing in the response mentions where the content came from — that is the feature.
    expect(JSON.stringify(res.headers)).not.toContain('vercel');
    expect(String(res.body)).not.toContain('vercel');
  });

  it('drops an upstream cookie and refuses to be cached', async () => {
    fetchMock.mockResolvedValue(
      upstream('<html></html>', {
        'content-type': 'text/html',
        'set-cookie': 'session=theirs',
        'cache-control': 'public, max-age=600',
      }),
    );
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);

    // One client's report, on a URL that differs from another's only by hostname.
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('records the open in the audit log, once, for the page and not its assets', async () => {
    const d = deps();
    await portalProxy(d)(fakeReq('/rapportage-q3/'), fakeRes(), vi.fn() as NextFunction);
    expect(d.audit.record).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.audit.record).mock.calls[0]?.[1]).toMatchObject({
      action: 'portal.read',
      entityId: CLIENT,
      detail: expect.objectContaining({ read: 'page', subject: 'rapportage-q3' }),
    });

    await portalProxy(d)(fakeReq('/rapportage-q3/assets/index.js'), fakeRes(), vi.fn() as NextFunction);
    expect(d.audit.record).toHaveBeenCalledTimes(1);
  });

  it('does not serve a page it could not audit', async () => {
    // The audit is why a client's content may live here at all. "Served but not recorded"
    // is the one outcome that must not be reachable.
    const d = deps({ db: { transaction: vi.fn().mockRejectedValue(new Error('database is down')) } });
    const res = fakeRes();
    await portalProxy(d)(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows an upstream redirect only while it stays on the source origin', async () => {
    fetchMock.mockResolvedValue(
      upstream('', { location: 'https://evil.example/steal' }, 302),
    );
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    // Following it would hand the bypass secret to whoever that origin is.
    expect(res.statusCode).toBe(502);
    expect(res.redirected).toBeUndefined();
  });

  // ── the security review's first finding ──

  it('refuses to walk out of the page with ..', async () => {
    // Express does not normalise the request line and encodeURIComponent leaves dots alone,
    // so this reached `fetch`, which collapsed it — an arbitrary path on the source origin,
    // with the bypass secret attached. Where several clients' reports share a deployment,
    // that is a cross-client read of exactly what the proxy exists to gate.
    for (const path of [
      '/rapportage-q3/../../elders/geheim.html',
      '/rapportage-q3/%2e%2e/%2e%2e/elders/',
      '/rapportage-q3/assets/../../../etc/',
    ]) {
      const res = fakeRes();
      await portalProxy(deps())(fakeReq(path), res, vi.fn() as NextFunction);
      expect(res.statusCode, path).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never emits a protocol-relative redirect', async () => {
    // `//rapportage-q3` survives filter(Boolean), and echoing req.path back would have made
    // the Location another host rather than a path on this one.
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('//rapportage-q3'), res, vi.fn() as NextFunction);
    expect(res.redirected?.to).toBe('/rapportage-q3/');
  });

  it('stops a report from acting as the client', async () => {
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    // HttpOnly stops a script reading the cookie; it does not stop a script using it. This
    // is what keeps a compromised report from POSTing to /api/portal/quotes/<id>/accept:
    // the portal's own API is outside the page's subtree, so it is not a connect-src match.
    expect(res.headers['content-security-policy']).toContain(
      'connect-src duce.finsera.nl/rapportage-q3/',
    );
    expect(res.headers['content-security-policy']).toContain("form-action 'none'");
  });

  it('lets a report fetch its own data, on its own host', async () => {
    // A CSP source ending in `/` matches by path prefix, so `meta.json` and `api/state` —
    // both proxied, both under the page — load, and nothing above the page does. Scheme-less
    // so it holds on https in production and on http at localhost.
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).not.toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src [^;]*https?:/);
  });

  it('lets a report load its webfont, and only its webfont', async () => {
    // Report builds link IBM Plex from Google Fonts; the stylesheet host and the font host
    // are separate, so one without the other still falls back to the system font.
    const res = fakeRes();
    await portalProxy(deps())(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    // Not in connect-src: a font origin is not a way back out of the page.
    expect(csp).toContain('connect-src duce.finsera.nl/rapportage-q3/;');
  });

  it('forwards a write to the page, body and all', async () => {
    const res = fakeRes();
    const d = deps();
    await portalProxy(d)(
      fakeWrite('/rapportage-q3/api/state', { aanname: 'A2' }),
      res,
      vi.fn() as NextFunction,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://rapportage-q3-duce.vercel.app/api/state');
    expect(init.method).toBe('POST');
    // The parser already read the stream, so the body has to come off `req.body`. Piping the
    // request would have sent an empty POST and the deployment would have saved nothing.
    expect(init.body).toBe(JSON.stringify({ aanname: 'A2' }));
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('records a write wherever in the page it lands', async () => {
    // A read is audited at the page root only; a change to a client's saved state is the
    // record itself, so depth is not a reason to skip it.
    const d = deps();
    await portalProxy(d)(
      fakeWrite('/rapportage-q3/api/state', { aanname: 'A2' }),
      fakeRes(),
      vi.fn() as NextFunction,
    );
    expect(d.audit.record).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.audit.record).mock.calls[0]?.[1]).toMatchObject({
      action: 'portal.write',
      entityId: CLIENT,
      detail: { subject: 'rapportage-q3', path: '/rapportage-q3/api/state', method: 'POST' },
    });
  });

  it('refuses a write it cannot record, before the deployment sees it', async () => {
    const d = deps({
      db: { transaction: vi.fn().mockRejectedValue(new Error('down')) },
      audit: { record: vi.fn() },
    });
    const res = fakeRes();
    await portalProxy(d)(fakeWrite('/rapportage-q3/api/state', {}), res, vi.fn() as NextFunction);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never answers a write with a redirect to the trailing slash', async () => {
    // A browser turns a redirected POST into a GET and drops the body, so the 301 that is
    // right for a read would lose a save without saying so.
    const res = fakeRes();
    await portalProxy(deps())(fakeWrite('/rapportage-q3', {}), res, vi.fn() as NextFunction);
    expect(res.redirected).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('still leaves a method nobody proxies to the SPA', async () => {
    const next = vi.fn() as NextFunction;
    await portalProxy(deps())(fakeWrite('/rapportage-q3/', {}, 'OPTIONS'), fakeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a redirect page by sending the browser to the real address', async () => {
    const d = deps({
      pages: {
        find: vi.fn().mockResolvedValue({ ...PAGE, kind: 'redirect' }),
        secretFor: vi.fn(),
      },
    });
    const res = fakeRes();
    await portalProxy(d)(fakeReq('/rapportage-q3/'), res, vi.fn() as NextFunction);
    expect(res.redirected).toEqual({ status: 302, to: PAGE.sourceUrl });
  });
});

describe('rewriteRootUrls', () => {
  it('moves root-absolute references under the page', () => {
    const html = '<script src="/assets/index-abc.js"></script><link href=\'/style.css\'>';
    expect(rewriteRootUrls(html, 'report1')).toBe(
      '<script src="/report1/assets/index-abc.js"></script><link href=\'/report1/style.css\'>',
    );
    expect(rewriteRootUrls('body{background:url(/bg.png)}', 'report1')).toBe(
      'body{background:url(/report1/bg.png)}',
    );
  });

  it('leaves alone what is not a path on this host', () => {
    // `//` is another host, and a relative URL already resolves correctly under the page.
    const untouched = '<img src="//cdn.example/x.png"><a href="https://finsera.nl"><img src="./a.png">';
    expect(rewriteRootUrls(untouched, 'report1')).toBe(untouched);
  });
});

describe('underSource', () => {
  const source = 'https://report.vercel.app/duce/q3';

  it('builds a URL under the page and nowhere else', () => {
    // The page root keeps its trailing slash, which is what makes relative URLs inside the
    // report resolve under the page rather than one level above it.
    expect(underSource(source, '', '')).toBe('https://report.vercel.app/duce/q3/');
    expect(underSource(source, 'assets/x.js', '?v=1')).toBe(
      'https://report.vercel.app/duce/q3/assets/x.js?v=1',
    );
  });

  it('refuses anything that climbs out', () => {
    for (const rest of ['../../dochorse/', '..', 'a/../../..%2f', '../q3-other/']) {
      expect(underSource(source, rest, ''), rest).toBeNull();
    }
  });
});

describe('sameOriginPath', () => {
  const source = 'https://report.vercel.app/q3';

  it('translates a redirect that stays put', () => {
    expect(sameOriginPath('/q3/', source, 'r')).toBe('/r/');
    expect(sameOriginPath('https://report.vercel.app/q3/page?a=1', source, 'r')).toBe('/r/page?a=1');
  });

  it('refuses one that leaves', () => {
    for (const away of ['https://evil.example/x', '//evil.example/x', '/elsewhere', 'not a url']) {
      expect(sameOriginPath(away, source, 'r'), away).toBeNull();
    }
  });
});

describe('isPrivate', () => {
  it('knows the addresses a page may not be fetched from', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1',
      // The v4-mapped form of the cloud metadata address — the one a check written
      // against dotted quads alone lets straight through.
      '::ffff:169.254.169.254',
    ]) {
      expect(isPrivate(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['76.76.21.21', '1.1.1.1', '172.32.0.1', '192.169.0.1', '2606:4700::1']) {
      expect(isPrivate(address), address).toBe(false);
    }
  });
});
