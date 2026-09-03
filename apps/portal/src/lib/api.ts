/**
 * The portal's only way to reach the server.
 *
 * Every path is under `/api/portal`, and that is enforced here rather than left to each
 * caller: a typo pointing at `/api/billing` would otherwise produce a 401 in development
 * and a puzzled bug report, instead of failing immediately and obviously.
 *
 * Authentication is a cookie the browser sends on its own (Phase 8). What this adds is the
 * `X-Requested-With` header the API demands on every write, which a cross-site form cannot
 * add — the second lock behind `SameSite=Lax`.
 */
export class PortalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/portal${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'portal',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

/**
 * Open a file the API serves. A plain navigation now: the cookie goes with it, so there is
 * no longer a blob to download and re-serve, and the browser's own PDF viewer gets a URL it
 * can reload.
 */
export function openFile(path: string): void {
  window.open(`/api/portal${path}`, '_blank', 'noopener');
}

export interface PortalProject {
  id: string;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
}

/** A piece of work being done for the client, in the reduced form they are shown. */
export interface PortalTask {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  status: string;
  type: string;
  due_on: string | null;
  completed_at: string | null;
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

export interface PortalQuoteLine {
  description: string;
  quantity: string;
  unit: string | null;
  unit_price_cents: number;
  amount_cents: number;
}

/** A conversation with Finsera, as it appears in the list. */
export interface PortalTicket {
  id: string;
  subject: string;
  status: 'waiting_on_finsera' | 'waiting_on_client' | 'closed';
  created_at: string;
  last_activity_at: string;
  message_count: number;
}

export interface PortalTicketMessage {
  id: string;
  author_kind: 'client' | 'internal';
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface PortalThread {
  id: string;
  subject: string;
  status: PortalTicket['status'];
  createdAt: string;
  messages: PortalTicketMessage[];
}

export interface PortalDocument {
  id: string;
  title: string;
  category: string | null;
  created_at: string;
}

/** Who is looking. `staff` is one of us; a client sees `staff: false` and no banner. */
export interface PortalMe {
  email: string;
  staff: boolean;
  /** Whose portal this is, sent only to staff — a client already knows. */
  clientName?: string | null;
}

/** A page of custom content. The link is a path on this host; the source is never sent. */
export interface PortalPage {
  slug: string;
  title: string;
  kind: string;
}

export const api = {
  me: () => request<PortalMe>('/me'),
  projects: () => request<PortalProject[]>('/projects'),
  tasks: () => request<PortalTask[]>('/tasks'),
  invoices: () => request<PortalInvoice[]>('/invoices'),
  quotes: () => request<PortalQuote[]>('/quotes'),
  documents: () => request<PortalDocument[]>('/documents'),
  pages: () => request<PortalPage[]>('/pages'),
  quoteLines: (id: string) => request<PortalQuoteLine[]>(`/quotes/${id}/lines`),
  acceptQuote: (id: string) =>
    request<{ id: string; number: string; status: string }>(`/quotes/${id}/accept`, 'POST'),
  tickets: () => request<PortalTicket[]>('/tickets'),
  ticket: (id: string) => request<PortalThread>(`/tickets/${id}`),
  openTicket: (input: { subject: string; body: string; projectId?: string }) =>
    request<{ id: string; status: string }>('/tickets', 'POST', input),
  replyToTicket: (id: string, body: string) =>
    request<{ id: string; status: string }>(`/tickets/${id}/messages`, 'POST', { body }),
};
