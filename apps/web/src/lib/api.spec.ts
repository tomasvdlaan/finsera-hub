import { beforeEach, describe, expect, it, vi } from 'vitest';
/*
 * Type-only, so it is erased before it can run — the module below must not be imported for
 * real until './auth.js' has been mocked, which is what the dynamic import at the bottom of
 * this block is for.
 */
import type { ApiError as ApiErrorType } from './api.js';

/**
 * `auth.ts` builds a UserManager at import time and reads `window.location`, so importing the
 * API client for real would need a DOM to check something that has nothing to do with one.
 * Mocked before import rather than worked around.
 */
vi.mock('./auth.js', () => ({ getUser: async () => null }));

const { api, ApiError, isExpiredSession, isRefused } = await import('./api.js');

/**
 * What the client does with a response body.
 *
 * The case that brought this here: Nest serialises a handler returning `null` as a 200 with
 * no body at all. `GET /scrum/projects/:id/sprint` does exactly that for a project with no
 * active sprint — a correct, expected answer — and `res.json()` threw "Unexpected end of JSON
 * input", which surfaced on the board as a red parse error where a sprint should have been.
 *
 * Worth a test rather than a fix and a shrug, because every future endpoint that can honestly
 * answer "nothing" walks into it, and the symptom names the wrong culprit.
 */
describe('api response bodies', () => {
  const respond = (init: { status?: number; body?: string }) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(init.body || null, { status: init.status ?? 200 })),
    );

  beforeEach(() => vi.unstubAllGlobals());

  it('reads an empty 200 as null rather than throwing', async () => {
    respond({ status: 200, body: '' });
    await expect(api.get('/scrum/projects/x/sprint')).resolves.toBeNull();
  });

  it('still parses a body that is there', async () => {
    respond({ status: 200, body: JSON.stringify({ name: 'Sprint 1' }) });
    await expect(api.get('/scrum/sprints/x')).resolves.toEqual({ name: 'Sprint 1' });
  });

  it('reads a literal null body as null', async () => {
    // Distinct from the empty case: some handlers do serialise the four characters.
    respond({ status: 200, body: 'null' });
    await expect(api.get('/scrum/projects/x/sprint')).resolves.toBeNull();
  });

  it('leaves 204 as undefined, which is what a delete returns', async () => {
    respond({ status: 204 });
    await expect(api.del('/core/comments/x')).resolves.toBeUndefined();
  });

  it('raises the server’s message, not a parse error, when the call fails', async () => {
    respond({ status: 400, body: JSON.stringify({ message: 'That sprint is finished.' }) });
    await expect(api.post('/scrum/sprints/x/start', {})).rejects.toThrow(
      'That sprint is finished.',
    );
  });

  it('falls back to the status when a failure carries no body', async () => {
    respond({ status: 502, body: '' });
    await expect(api.get('/scrum/sprints')).rejects.toThrow(/502/);
  });
});

/**
 * Why a call failed, not just that it did.
 *
 * The lockout this guards against: the shell caught every failure of `/core/me` the same
 * way, showed a banner, and left `me` null — and the avatar, the only route to Sign out, was
 * rendered on `me`. A session the server had stopped accepting could therefore not be
 * abandoned from the UI at all; clearing the tab's storage by hand was the only way back to
 * a sign-in screen.
 *
 * The two auth failures need opposite responses, which is why the status has to survive.
 */
describe('why a request failed', () => {
  const failWith = (status: number, body?: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body ?? null, { status })),
    );

  beforeEach(() => vi.unstubAllGlobals());

  it('carries the status, so a caller can tell one failure from another', async () => {
    failWith(401, JSON.stringify({ message: 'Invalid token' }));
    const error = await api.get('/core/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiErrorType).status).toBe(401);
    // Still an Error, so everything that only wants the message keeps working.
    expect((error as Error).message).toBe('Invalid token');
  });

  it('reads 401 as a dead session — the token is what was refused', async () => {
    failWith(401);
    const error = await api.get('/core/me').catch((e: unknown) => e);

    expect(isExpiredSession(error)).toBe(true);
    expect(isRefused(error)).toBe(false);
  });

  it('reads 403 as a refused account, which signing in again cannot fix', async () => {
    /*
     * The distinction that matters. `auth.guard.ts` throws 401 when the token itself is bad;
     * `user.service.ts` throws 403 for an account that is deactivated or was never let in.
     * Clearing the session on a 403 would bounce that person through Zitadel and back to the
     * identical 403, for ever — so it must not be treated as an expiry.
     */
    failWith(403, JSON.stringify({ message: 'This account has been deactivated' }));
    const error = await api.get('/core/me').catch((e: unknown) => e);

    expect(isRefused(error)).toBe(true);
    expect(isExpiredSession(error)).toBe(false);
    expect((error as Error).message).toBe('This account has been deactivated');
  });

  it('treats an ordinary server failure as neither', async () => {
    failWith(500);
    const error = await api.get('/core/me').catch((e: unknown) => e);

    expect(isExpiredSession(error)).toBe(false);
    expect(isRefused(error)).toBe(false);
  });

  it('does not mistake a thrown non-ApiError for an auth failure', async () => {
    // A network error is a TypeError from fetch, with no status at all.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await api.get('/core/me').catch((e: unknown) => e);

    expect(isExpiredSession(error)).toBe(false);
    expect(isRefused(error)).toBe(false);
  });
});
