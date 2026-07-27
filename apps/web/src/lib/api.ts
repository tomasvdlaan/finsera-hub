import { getUser } from './auth.js';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = await getUser();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(user?.access_token ? { Authorization: `Bearer ${user.access_token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
};
