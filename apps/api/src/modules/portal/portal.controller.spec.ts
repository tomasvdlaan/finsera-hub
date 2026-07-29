import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { IS_PUBLIC } from '../../core/auth/public.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalController } from './portal.controller.js';

/**
 * The wiring, asserted rather than trusted.
 *
 * `AuthGuard` is an APP_GUARD, so the portal must opt out of it with `@Public()` to be
 * reachable at all — and `@Public()` on its own would publish every client's invoices to
 * the internet. The two decorators have to travel together, and nothing about reading the
 * file makes their separation obvious: the routes would work, the projection would behave
 * correctly, and every other test in this module would still pass.
 *
 * So the pairing is checked here, mechanically.
 */
describe('PortalController wiring', () => {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, PortalController) ?? []) as unknown[];

  it('waives the internal guard', () => {
    // Without this the portal demands an internal token and no client can use it.
    expect(Reflect.getMetadata(IS_PUBLIC, PortalController)).toBe(true);
  });

  it('replaces it with the portal guard', () => {
    // The half that matters. If this ever fails, the controller is open to the internet.
    expect(guards).toContain(PortalAuthGuard);
  });

  it('applies the guard at class level, so a new route cannot miss it', () => {
    // Per-route guards would mean the next endpoint someone adds is unprotected by
    // default. At class level, forgetting is not an available mistake.
    const proto = PortalController.prototype as unknown as Record<string, object>;
    const routes = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const handler = proto[route];
      if (!handler) continue;
      const own = Reflect.getMetadata(IS_PUBLIC, handler);
      // A route re-declaring @Public() would waive the class guard for itself.
      expect(own, `${route} declares its own @Public()`).toBeUndefined();
    }
  });

  it('exposes only read routes', () => {
    // Step 3 is read-only. Quote acceptance (step 4) is the first write, and it should
    // arrive as a deliberate change to this list rather than as an unnoticed addition.
    const routes = Object.getOwnPropertyNames(PortalController.prototype).filter(
      (name) => name !== 'constructor' && name !== 'send',
    );
    expect(routes.sort()).toEqual([
      'documentDownload',
      'documents',
      'invoicePdf',
      'invoices',
      'me',
      'projects',
      'quoteLines',
      'quotes',
    ]);
  });
});
