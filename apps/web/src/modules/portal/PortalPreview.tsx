import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../shell/ui/layout.js';
import { api } from '../../lib/api.js';

interface Project {
  id: string;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
}
interface Invoice {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  due_on: string;
  total_cents: number;
  currency: string;
  overdue: boolean;
}
interface Quote {
  id: string;
  number: string;
  title: string;
  status: string;
  valid_until: string | null;
  total_cents: number;
  expired: boolean;
}
interface Doc {
  id: string;
  title: string;
  created_at: string;
}

const money = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(cents / 100);

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

/**
 * What this client sees when they log into the portal.
 *
 * Served by the same projection the portal itself uses, so this cannot drift into showing
 * something a client would not get — a preview that is wrong is worse than none, because
 * it is believed. Read-only: the endpoints behind it have no write routes at all.
 *
 * Every load is written to the audit log against this client. That is deliberate and
 * worth saying out loud in the UI, because someone using it should know it is recorded
 * rather than discover that later.
 */
export function PortalPreview() {
  const { id: clientId } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    projects: Project[];
    invoices: Invoice[];
    quotes: Quote[];
    documents: Doc[];
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    const base = `/portal-preview/${clientId}`;

    Promise.all([
      api.get<Project[]>(`${base}/projects`),
      api.get<Invoice[]>(`${base}/invoices`),
      api.get<Quote[]>(`${base}/quotes`),
      api.get<Doc[]>(`${base}/documents`),
    ])
      .then(([projects, invoices, quotes, documents]) => {
        if (live) setData({ projects, invoices, quotes, documents });
      })
      .catch((err: Error) => live && setError(err.message));

    return () => {
      live = false;
    };
  }, [clientId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const empty =
    !data.projects.length && !data.invoices.length && !data.quotes.length && !data.documents.length;

  return (
    <div>
      <PageHeader
        title="Portal preview"
        back={{ to: `/clients/${clientId}`, label: 'Back to client' }}
      />

      {/*
        A warning tone, from tokens.

        This was a hardcoded #fff7ed on #fdba74 — a light-orange banner that stayed light
        orange on a near-black canvas, and the second of these found in one sweep. Warning
        rather than danger: looking is not doing, and the point of the notice is that the
        looking is recorded, not that anything is wrong.
      */}
      <div className="card" data-tone="warning">
        <strong>Preview.</strong> This is the client&rsquo;s own view of the portal, read-only.
        Opening it is recorded in the audit log against this client.
      </div>

      {empty && (
        <p className="muted">
          This client would see an empty portal. Nothing is shared with them yet: no issued
          invoices, no sent quotes, and no documents explicitly shared.
        </p>
      )}

      {data.projects.length > 0 && (
        <>
          <h3>Projects</h3>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.status}</td>
                  <td>{day(p.starts_on)}</td>
                  <td>{day(p.ends_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.quotes.length > 0 && (
        <>
          <h3>Quotes</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Valid until</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.quotes.map((q) => (
                <tr key={q.id}>
                  <td>{q.number}</td>
                  <td>{q.title}</td>
                  <td>{day(q.valid_until)}</td>
                  <td>{money(q.total_cents)}</td>
                  <td>{q.expired && q.status === 'sent' ? 'expired' : q.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.invoices.length > 0 && (
        <>
          <h3>Invoices</h3>
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{day(i.issue_date)}</td>
                  <td>{day(i.due_on)}</td>
                  <td>{money(i.total_cents, i.currency)}</td>
                  <td>{i.status === 'paid' ? 'paid' : i.overdue ? 'overdue' : 'open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.documents.length > 0 && (
        <>
          <h3>Shared documents</h3>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Shared</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td>{day(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
