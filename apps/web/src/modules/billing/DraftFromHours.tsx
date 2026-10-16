import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { refreshShared, useShared } from '../../lib/useShared.js';
import { Card, Figure } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Button } from '../../shell/ui/primitives.js';
import { money } from './types.js';

/** One project's share of `GET /reporting/unbilled`. */
export interface Unbilled {
  projectId: string;
  projectName: string;
  clientName: string | null;
  minutes: number;
  valueCents: number;
}

export const hoursOf = (minutes: number) => `${(minutes / 60).toFixed(1).replace(/\.0$/, '')}h`;

/**
 * Hours into a draft invoice, and straight on to the draft.
 *
 * The draft is where the next decision is — check the lines, then issue — so arriving back at
 * a list that has one more row in it is a step the person then has to take by hand. Every
 * place that offers this ends on the invoice it made.
 */
export function useDraftFromHours() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = async (projectId: string) => {
    setBusy(true);
    setError(null);
    try {
      const invoice = await api.post<{ id: string }>('/billing/invoices/draft-from-hours', {
        projectId,
      });
      refreshShared();
      navigate(`/money/invoices/${invoice.id}`);
    } catch (e) {
      // The server's refusals are written for people — "set an hourly rate first" — so they
      // are shown as they are rather than replaced with something vaguer.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { draft, busy, error };
}

/**
 * What this project has earned and not yet billed — and the button that bills it.
 *
 * Contributed to CRM's project page. Before it, the unbilled figure lived on Money and in an
 * Inbox item that both linked here, to a page with no way to act on it; the only control that
 * could draft the invoice was a select of every project on the invoice list.
 */
export function ProjectUnbilledWidget({ projectId }: { projectId: string }) {
  const { data, loading, error: loadError } = useShared<{ byProject: Unbilled[] }>(
    '/reporting/unbilled',
  );
  const { draft, busy, error } = useDraftFromHours();
  const row = data?.byProject.find((p) => p.projectId === projectId);

  return (
    <Card title="Unbilled" error={loadError}>
      {loading ? (
        <Skeleton height="3rem" />
      ) : !row || row.minutes === 0 ? (
        <p className="muted">Every billable hour on this project has been invoiced.</p>
      ) : (
        <>
          <Figure
            label="Not yet invoiced"
            value={money(row.valueCents)}
            note={`${hoursOf(row.minutes)} of billable work`}
          />
          <div className="card-actions">
            <Button variant="primary" onClick={() => void draft(projectId)} disabled={busy}>
              {busy ? 'Drafting…' : 'Draft invoice'}
            </Button>
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </Card>
  );
}
