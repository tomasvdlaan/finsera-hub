import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { IS_PUBLIC } from '../../core/auth/public.decorator.js';
import { PortalAuthController, safeNext } from './portal-auth.controller.js';

/**
 * The login routes are the one part of the portal that is reachable with no session at all,
 * and that is asserted rather than assumed — along with the fact that they are exactly the
 * five routes the flow in the controller's comment describes.
 */
describe('PortalAuthController wiring', () => {
  const proto = PortalAuthController.prototype as unknown as Record<string, object>;
  const routeNames = Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined,
  );

  it('is public, because nobody has a session before they log in', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, PortalAuthController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, PortalAuthController)).toBeUndefined();
  });

  it('exposes exactly the login flow', () => {
    expect([...routeNames].sort()).toEqual([
      'callback', 'complete', 'login', 'logout', 'signedOut', 'start',
    ]);
  });
});

describe('safeNext', () => {
  it('keeps a path on this host', () => {
    expect(safeNext('/rapporten')).toBe('/rapporten');
    expect(safeNext('/facturen?x=1')).toBe('/facturen?x=1');
  });

  it('refuses anything that could leave the host', () => {
    // A `next` that reads as a URL is an open redirect with a fresh session on the end of it.
    for (const bad of [undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'rapporten', '/api/portal/me']) {
      expect(safeNext(bad), String(bad)).toBe('/');
    }
  });
});
