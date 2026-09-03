import { existsSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { PortalHostService } from './portal-host.service.js';

/**
 * The portal SPA, served by the API — on portal hosts only.
 *
 * Caddy serves the internal app's bundle from disk and proxies `/api/*`, which works because
 * on `hub` the split is static: a path is either the API or a file. On a portal host it is
 * not: `duce.finsera.nl/report1` is a proxied page if the client has a page with that slug,
 * and the SPA otherwise, and only the database knows which (Phase 8 §4.3). So Caddy sends a
 * portal host's traffic here wholesale, and this decides.
 *
 * Step 1 decides between two things — the API and the bundle. Step 3 adds the page table
 * between them.
 *
 * Deliberately not `express.static` with a fallthrough: that would also answer on `hub`, and
 * an SPA that appears on the wrong hostname is a confusing kind of wrong. The host check is
 * the first thing here.
 */
export function portalStatic(hosts: PortalHostService, dir: string | undefined) {
  if (!dir) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`PORTAL_STATIC_DIR=${dir} has no index.html — was the portal built?`);
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path === '/api') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let portalHost;
    try {
      portalHost = await hosts.resolve(req.headers.host);
    } catch (err) {
      return next(err);
    }
    if (!portalHost) return next();

    // Resolve inside the bundle directory, and refuse anything that resolves outside it.
    // `normalize` collapses `..`; the prefix check is what makes the collapse safe.
    const wanted = normalize(join(root, decodeURIComponent(req.path)));
    const inside = wanted === root || wanted.startsWith(root + sep);
    const isFile = inside && existsSync(wanted) && statSync(wanted).isFile();

    if (isFile) {
      // Vite names assets by content hash, so they are immutable for as long as they exist.
      if (req.path.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return res.sendFile(wanted, { dotfiles: 'deny' }, (err) => err && next(err));
    }

    // History fallback: every other path is a route in the SPA. Never cached, and never
    // framed — the portal is not something another site gets to embed.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    return res.sendFile(index, (err) => err && next(err));
  };
}
