import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from './graph.client.js';

/** A Response, without pulling in a real one. */
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const TOKEN = { access_token: 'tok-1', expires_in: 3600 };

describe('GraphClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GRAPH_TENANT_ID = 'tenant';
    process.env.GRAPH_CLIENT_ID = 'client';
    process.env.GRAPH_CLIENT_SECRET = 'secret';
    process.env.GRAPH_SITE_ID = 'site';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.GRAPH_TENANT_ID;
    delete process.env.GRAPH_CLIENT_ID;
    delete process.env.GRAPH_CLIENT_SECRET;
    delete process.env.GRAPH_SITE_ID;
  });

  /**
   * The API has to start and stay up during a tenant outage, and with no credential at all.
   * So an unconfigured client must fail at the call, saying which variable is missing —
   * never at boot, and never by reaching the network to find out.
   */
  it('refuses to call when unconfigured, and names the missing variable', async () => {
    delete process.env.GRAPH_CLIENT_SECRET;
    const client = new GraphClient();

    expect(client.configured).toBe(false);
    expect(client.unconfiguredReason).toContain('GRAPH_CLIENT_SECRET');
    await expect(client.call('GET', '/me')).rejects.toThrow('GRAPH_CLIENT_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Ten concurrent uploads finding an expired token must produce ONE token request.
   *
   * The bug this guards is not wasted calls: it is Entra throttling the token endpoint
   * because a bulk operation asked it for forty tokens in a second.
   */
  it('fetches one token for concurrent callers, then reuses it', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com') ? reply(200, TOKEN) : reply(200, { ok: true }),
    );
    const client = new GraphClient();

    await Promise.all([
      client.call('GET', '/a'),
      client.call('GET', '/b'),
      client.call('GET', '/c'),
    ]);
    await client.call('GET', '/d');

    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('login.microsoftonline.com'),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  /**
   * Retry-After is not a suggestion. Ignoring it is how a throttle becomes a longer one, so
   * the wait must be the length Microsoft asked for rather than our own backoff.
   */
  it('waits exactly as long as Retry-After says, then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(reply(200, TOKEN))
      .mockResolvedValueOnce(reply(429, 'slow down', { 'retry-after': '5' }))
      .mockResolvedValueOnce(reply(200, { ok: true }));

    const client = new GraphClient();
    const pending = client.call<{ ok: boolean }>('GET', '/throttled');
    const settled = vi.fn();
    void pending.then(settled);

    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  /** Three attempts, not an indefinite storm against a tenant that is already struggling. */
  it('gives up after a bounded number of attempts', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com') ? reply(200, TOKEN) : reply(503, 'unavailable'),
    );

    const client = new GraphClient();
    const pending = client.call('GET', '/flaky');
    const caught = pending.then<never, Error>(
      () => {
        throw new Error('expected a rejection');
      },
      (err: Error) => err,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await caught).message).toContain('503');

    const graphCalls = fetchMock.mock.calls.filter(
      (c) => !String(c[0]).includes('login.microsoftonline.com'),
    );
    expect(graphCalls).toHaveLength(3);
  });

  /**
   * An upload-session commit must never be retried blindly: committing the same chunk range
   * twice fails in a way that is much harder to read than the failure that prompted it.
   */
  it('does not retry a call marked non-idempotent', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com') ? reply(200, TOKEN) : reply(429, 'slow down'),
    );

    const client = new GraphClient();
    await expect(
      client.call('POST', '/commit', { idempotent: false }),
    ).rejects.toThrow('429');

    const graphCalls = fetchMock.mock.calls.filter(
      (c) => !String(c[0]).includes('login.microsoftonline.com'),
    );
    expect(graphCalls).toHaveLength(1);
  });

  /**
   * One fresh token on a 401, and only one.
   *
   * A token that expired early is worth another go; a credential that is simply wrong is not,
   * and hammering Entra with a wrong secret is how an app registration gets locked out.
   */
  it('retries a 401 once with a new token, then surfaces the Graph error body', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? reply(200, TOKEN)
        : reply(401, { error: { code: 'accessDenied', message: 'no Sites.Selected grant' } }),
    );

    const client = new GraphClient();
    await expect(client.call('GET', '/denied')).rejects.toThrow('no Sites.Selected grant');

    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('login.microsoftonline.com'),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  /**
   * Entra's own error body names the real problem — an expired secret, a consent never
   * granted. A generic "unavailable" here costs an afternoon of guessing.
   */
  it('surfaces why Entra refused the credentials', async () => {
    fetchMock.mockResolvedValue(
      reply(401, { error_description: 'AADSTS7000222: client secret has expired' }),
    );

    const client = new GraphClient();
    await expect(client.call('GET', '/anything')).rejects.toThrow('AADSTS7000222');
    expect(client.lastFailure).toContain('AADSTS7000222');
  });

  /**
   * An expected status is an answer, not a failure. `ensureFolder` learns it has to create a
   * folder from a 404, and a 404 that arrives as a thrown exception cannot be read that way.
   */
  it('returns a tolerated status instead of throwing', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com') ? reply(200, TOKEN) : reply(404, 'not found'),
    );

    const client = new GraphClient();
    const res = await client.raw('GET', '/drives/d/root:/Missing', { tolerate: [404] });

    expect(res.status).toBe(404);
    expect(client.lastFailure).toBeNull();
  });
});
