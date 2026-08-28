import { getUser } from './auth.js';

/**
 * A failed request, with the status still attached.
 *
 * The status used to be flattened into a message string, which meant every caller could
 * show that a call failed and none could tell *why* — and the two auth failures need
 * opposite cures. A 401 is a dead token: signing in again fixes it. A 403 is a live token
 * belonging to an account that has been deactivated or was never let in, and signing in
 * again returns the identical 403, forever. Telling them apart requires the number.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The token is not accepted — the session is over, whoever it belonged to. */
export const isExpiredSession = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * Authenticated, and refused anyway.
 *
 * Kept distinct from the above because the cure is the opposite one: this account must not
 * be bounced back through Zitadel, it has to be able to read why and sign out.
 */
export const isRefused = (e: unknown) => e instanceof ApiError && e.status === 403;

/**
 * `signal` exists for the calls that can take a while — anything that runs a model.
 *
 * `fetch` has no timeout of its own, so a request that never settles leaves its caller
 * waiting forever. That is not abstract: the assistant panel refuses a new question while one
 * is in flight, so a single request that never came back made the panel permanently
 * unusable, with a reload the only way out.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const user = await getUser();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(detail?.message ?? `${res.status} ${res.statusText}`, res.status);
  }
  /*
   * An empty body is `null`, not a parse error.
   *
   * Nest serialises a handler that returns `null` as a 200 with no body at all, so
   * `res.json()` throws "Unexpected end of JSON input" — an error about the response format
   * for what is actually a perfectly good answer. "This project has no active sprint" arrived
   * that way and surfaced on the board as a JSON parse failure.
   *
   * Reading the text first rather than testing Content-Length, because a chunked or
   * compressed response does not have to declare one.
   */
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * A file the endpoint generates, rather than JSON.
 *
 * Separate from `request` because everything after the status check differs: there is nothing
 * to parse, and the filename lives in a header rather than in a body.
 *
 * It exists at all because a plain `<a href="/api/…">` does not carry the bearer token — the
 * browser would fetch it unauthenticated and cheerfully save the 401 as a `.csv`, which is a
 * failure somebody discovers when they open it in front of their accountant.
 */
async function file(path: string): Promise<{ blob: Blob; filename: string }> {
  const user = await getUser();
  const res = await fetch(`/api${path}`, {
    headers: user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {},
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(detail?.message ?? `${res.status} ${res.statusText}`, res.status);
  }

  // `filename="uren_entries_mijn_2026-08-24.csv"` — fall back rather than saving something
  // called "download" if a proxy ever strips the header.
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? 'export.csv';
  return { blob: await res.blob(), filename };
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>('POST', path, body, signal),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
  file,
};
