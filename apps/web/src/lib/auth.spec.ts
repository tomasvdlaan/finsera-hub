import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The internal app must ask Zitadel for project roles.
 *
 * Asserted against the source text rather than by importing the module: `auth.ts` builds a
 * UserManager at import time and reads `window.location`, so importing it here would need a
 * DOM environment purely to check one string. Crude, and it holds — what is worth protecting
 * is that the scope this app requests contains the roles URN.
 *
 * The regression it guards against already happened: this app requested
 * 'openid profile email' while the portal requested the roles scope too, so the API could
 * never see an internal role and no new colleague could be provisioned at all. Two SPAs
 * diverging silently is not something anything else would notice.
 */
describe('OIDC scope', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

  it('requests the project roles scope', () => {
    expect(source).toContain("ROLES_SCOPE = 'urn:zitadel:iam:org:project:roles'");
    expect(source).toMatch(/scope:\s*`openid profile email \$\{ROLES_SCOPE\}`/);
  });

  it('still requests the basics', () => {
    expect(source).toContain('openid profile email');
  });
});

/**
 * Signing out has to work on the session most in need of it.
 *
 * Both assertions here used to read the source text and match the shape the code happened
 * to have. That is why they went green through the lockout they were written to prevent:
 * the property each one names — "the local session is dropped", "Sign out is reachable" —
 * was never actually checked, so an implementation that satisfied the regex and not the
 * property looked correct. These now run the code.
 */
describe('signing out', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

  it('offers a way to drop a session without navigating anywhere', () => {
    // What clearing the tab's storage by hand used to do, and the only cure for a token the
    // API rejects: `signoutRedirect` navigates away before the reason can be read.
    expect(source).toMatch(/export const clearSession\s*=\s*\(\)\s*=>\s*userManager\.removeUser/);
  });
});

describe('logout, as it behaves', () => {
  let removeUser: ReturnType<typeof vi.fn>;
  let signoutRedirect: ReturnType<typeof vi.fn>;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    // `auth.ts` reads window.location.origin at import time to build its redirect URIs, and
    // `logout` uses window.location.replace as its last resort. Both are stubbed rather
    // than the whole suite being moved to a DOM environment for one module.
    replace = vi.fn();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:5173', replace },
      sessionStorage: {},
    });
    removeUser = vi.fn().mockResolvedValue(undefined);
    signoutRedirect = vi.fn().mockResolvedValue(undefined);
    vi.doMock('oidc-client-ts', () => ({
      User: class {},
      WebStorageStateStore: class {},
      UserManager: class {
        events = { addUserLoaded: vi.fn(), addUserUnloaded: vi.fn(), removeUserLoaded: vi.fn(), removeUserUnloaded: vi.fn() };
        getUser = vi.fn().mockResolvedValue({ id_token: 'the-id-token' });
        removeUser = removeUser;
        signoutRedirect = signoutRedirect;
        signinRedirect = vi.fn();
      },
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  const load = async () => (await import('./auth.js')).logout;

  it('drops the local session even when the provider refuses the redirect', async () => {
    // The failure this guards: a rejection leaving the stored session in place, so the
    // button does nothing on the one session that needed it gone.
    signoutRedirect.mockRejectedValue(new Error('no id_token_hint the provider accepts'));

    await (await load())();

    expect(removeUser).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('drops it before navigating, not after coming back', async () => {
    // The real lockout: `signoutRedirect` navigates away and the stored user is only
    // removed when something handles the signout callback. Nothing here does, so a refused
    // account went to Zitadel, returned to `/`, and was refused again — with the one route
    // out being the one just taken.
    await (await load())();

    expect(removeUser).toHaveBeenCalled();
    const removedAt = removeUser.mock.invocationCallOrder[0]!;
    const navigatedAt = signoutRedirect.mock.invocationCallOrder[0]!;
    expect(removedAt).toBeLessThan(navigatedAt);
  });

  it('still tells the provider which session to end', async () => {
    await (await load())();
    // Read before the removal, so the provider does not have to ask the person which
    // session they meant.
    expect(signoutRedirect).toHaveBeenCalledWith({ id_token_hint: 'the-id-token' });
  });
});

/**
 * The way out of a bad session, rendered rather than grepped.
 *
 * This is the lockout itself, asserted where it happened — twice now. First the avatar was
 * gated on `me`, so the API refusing to describe you took Sign out with it. The fix moved
 * it onto the token's name, and the test pinned that shape: `/\{name && \(/`. But a token
 * need not carry a name at all, and this instance's does not — so the same account hit the
 * same dead end, under a sentence telling it to use a menu that was not there, with a green
 * test named "does not gate the avatar on /core/me" standing over it.
 *
 * The property is that Sign out is reachable whenever there is a session, whatever anyone
 * does or does not know about the person holding it. So it is rendered with nothing known.
 */
describe('the way out of a bad session', () => {
  it('renders the account menu when neither the API nor the token says who you are', async () => {
    vi.resetModules();
    vi.doMock('react-router-dom', () => ({
      NavLink: ({ children }: { children?: unknown }) => children,
      useNavigate: () => vi.fn(),
    }));
    vi.doMock('../shell/useCan.js', () => ({ useCan: () => ({ can: () => true }) }));
    vi.doMock('../shell/useRunningTimer.js', () => ({
      useRunningTimer: () => ({ running: null, needsDuration: false, busy: false, stop: vi.fn() }),
      elapsed: () => '0:00',
    }));

    const { TopNav } = await import('../shell/TopNav.js');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');

    const markup = renderToStaticMarkup(
      createElement(TopNav, {
        nav: [],
        counts: {},
        // Everything unknown: the API refuses, and the token carries no name.
        me: null,
        fallbackName: undefined,
        onSearch: vi.fn(),
        onLogout: vi.fn(),
      }),
    );

    expect(markup, 'the account menu is missing, so Sign out is unreachable').toContain(
      'class="avatar"',
    );
  });
});
