import { getUser } from './auth.js';

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
    throw new Error(detail?.message ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>('POST', path, body, signal),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
};
