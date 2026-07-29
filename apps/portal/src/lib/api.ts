import { getUser } from './auth.js';

/**
 * The portal's only way to reach the server.
 *
 * Every path is under `/api/portal`, and that is enforced here rather than left to each
 * caller: a typo pointing at `/api/billing` would otherwise produce a 401 in development
 * and a puzzled bug report, instead of failing immediately and obviously.
 */
export class PortalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string): Promise<T> {
  const user = await getUser();
  if (!user) throw new PortalError('Not signed in', 0);

  const res = await fetch(`/api/portal${path}`, {
    headers: { Authorization: `Bearer ${user.access_token}` },
  });
  if (!res.ok) throw new PortalError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return 'Uw sessie is verlopen. Log opnieuw in.';
  if (res.status === 403) return 'Geen toegang.';
  if (res.status === 404) return 'Niet gevonden.';
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `Er ging iets mis (${res.status})`;
  } catch {
    return `Er ging iets mis (${res.status})`;
  }
}

/** A file URL the browser fetches itself, with the token attached as a blob download. */
export async function openFile(path: string, filename?: string): Promise<void> {
  const user = await getUser();
  if (!user) throw new PortalError('Not signed in', 0);

  const res = await fetch(`/api/portal${path}`, {
    headers: { Authorization: `Bearer ${user.access_token}` },
  });
  if (!res.ok) throw new PortalError(await errorMessage(res), res.status);

  // Fetched rather than linked because the endpoint needs an Authorization header, which
  // a plain <a href> cannot carry. The object URL is revoked once the tab has it.
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) anchor.download = filename;
  else anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface PortalProject {
  id: string;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
}

export interface PortalInvoice {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  due_on: string;
  total_cents: number;
  currency: string;
  overdue: boolean;
}

export interface PortalQuote {
  id: string;
  number: string;
  title: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  total_cents: number;
  expired: boolean;
}

export interface PortalDocument {
  id: string;
  title: string;
  category: string | null;
  created_at: string;
}

export const api = {
  me: () => request<{ email: string }>('/me'),
  projects: () => request<PortalProject[]>('/projects'),
  invoices: () => request<PortalInvoice[]>('/invoices'),
  quotes: () => request<PortalQuote[]>('/quotes'),
  documents: () => request<PortalDocument[]>('/documents'),
};
