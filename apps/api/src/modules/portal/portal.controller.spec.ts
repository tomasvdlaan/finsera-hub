import { describe, expect, it } from 'vitest';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC } from '../../core/auth/public.decorator.js';
import { resolveViewer, resolveVisitor } from './current-visitor.decorator.js';
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

  /**
   * Actual routes, found by their route metadata rather than by excluding helper names.
   * A blocklist of method names silently stops being right the moment a private helper is
   * added — which is exactly what happened when read auditing landed.
   */
  const proto = PortalController.prototype as unknown as Record<string, object>;
  const routeNames = Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined,
  );

  it('applies the guard at class level, so a new route cannot miss it', () => {
    // Per-route guards would mean the next endpoint someone adds is unprotected by
    // default. At class level, forgetting is not an available mistake.
    const routes = routeNames;
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const handler = proto[route];
      if (!handler) continue;
      const own = Reflect.getMetadata(IS_PUBLIC, handler);
      // A route re-declaring @Public() would waive the class guard for itself.
      expect(own, `${route} declares its own @Public()`).toBeUndefined();
    }
  });

  it('exposes exactly these routes', () => {
    // The list is the point. Anything added to the portal's surface fails here until
    // somebody writes it down, which is the moment the addition gets looked at.
    expect([...routeNames].sort()).toEqual([
      'acceptQuote',
      'documentDownload',
      'documents',
      'invoicePdf',
      'invoices',
      'me',
      'openTicket',
      'pages',
      'projects',
      'quoteLines',
      'quotes',
      'replyToTicket',
      'tasks',
      'ticket',
      'tickets_',
    ]);
  });

  /**
   * Which routes an employee may use, asserted from the wiring rather than trusted.
   *
   * `@CurrentVisitor()` throws for a staff session and `@CurrentViewer()` does not, so a
   * route's choice between them IS the P5 rule. Both look identical at a call site, and a
   * new write route wired to the wrong one would work perfectly until a colleague used it
   * to accept a quote on a client's behalf.
   */
  it('lets staff read everything and act on nothing', () => {
    const factoryPerRoute = (route: string): unknown[] => {
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, PortalController, route) ??
        {}) as Record<string, { factory?: unknown }>;
      return Object.values(args).map((a) => a.factory);
    };

    // Everything that changes something asks for a visitor; everything else asks for a
    // viewer. The lists are spelled out so that adding a route means deciding which it is.
    const writes = ['acceptQuote', 'openTicket', 'replyToTicket'];
    for (const route of routeNames) {
      const factories = factoryPerRoute(route);
      const wantsVisitor = factories.includes(resolveVisitor);
      const wantsViewer = factories.includes(resolveViewer);
      expect(wantsVisitor || wantsViewer, `${route} resolves no portal session`).toBe(true);
      expect(wantsVisitor, `${route} asks for the wrong kind of session`).toBe(
        writes.includes(route),
      );
      expect(wantsViewer, `${route} asks for both kinds of session`).toBe(
        !writes.includes(route),
      );
    }
  });

  it('permits exactly these writes, and names them', () => {
    // Phase 7 step 4 added the first thing a client can change. This is the assertion that
    // was read-only until it was deliberately changed — every further write is as deliberate.
    const writes = routeNames.filter((name) => {
      const handler = proto[name];
      if (!handler) return false;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      return RequestMethod[method] !== 'GET';
    });
    // Accepting a quote, opening a ticket, and answering on one. Each had to be added here
    // deliberately, which is the only reason this assertion is worth having.
    expect(writes.sort()).toEqual(['acceptQuote', 'openTicket', 'replyToTicket']);
  });
});
