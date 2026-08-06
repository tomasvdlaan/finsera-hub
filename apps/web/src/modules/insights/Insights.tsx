import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';

export interface Insight {
  id: string;
  rule: string;
  subjectId: string | null;
  subjectType: string | null;
  severity: 'info' | 'attention' | 'urgent';
  status: 'open' | 'dismissed' | 'resolved';
  title: string;
  detail: string | null;
  facts: Record<string, unknown>;
  magnitude: number;
  firstSeenAt: string;
}

/** Where an insight's subject lives, so the sentence is one click from the thing itself. */
export function subjectPath(insight: Insight): string | null {
  if (!insight.subjectId) return null;
  switch (insight.subjectType) {
    case 'invoice':
      return `/billing/invoices/${insight.subjectId}`;
    case 'quote':
      return `/sales/quotes/${insight.subjectId}`;
    case 'contract':
      return `/sales/contracts/${insight.subjectId}`;
    case 'project':
      return `/crm/projects/${insight.subjectId}`;
    case 'task':
      return `/scrum/tasks/${insight.subjectId}`;
    case 'sprint':
      return `/scrum/sprints/${insight.subjectId}`;
    default:
      return null;
  }
}

export function InsightRow({
  insight,
  onDismiss,
  onRestore,
}: {
  insight: Insight;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  const path = subjectPath(insight);
  return (
    <li className={`insight sev-${insight.severity}`}>
      <div>
        <strong>{path ? <Link to={path}>{insight.title}</Link> : insight.title}</strong>
        {insight.detail && <div className="muted">{insight.detail}</div>}
      </div>
      <div className="insight-actions">
        <span className="badge">{insight.severity}</span>
        {onDismiss && (
          <button className="link-button" onClick={onDismiss}>
            dismiss
          </button>
        )}
        {onRestore && (
          <button className="link-button" onClick={onRestore}>
            restore
          </button>
        )}
      </div>
    </li>
  );
}

export function Insights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [status, setStatus] = useState<'open' | 'dismissed' | 'resolved'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<Insight[]>(`/insights?status=${status}`)
        .then(setInsights)
        .catch((e: Error) => setError(e.message)),
    [status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Insights</h1>
      <p className="muted">
        Things worth a look. Nothing here has been acted on — no message was sent and no
        record changed. An insight whose cause goes away disappears on its own; dismissing
        one keeps it hidden for as long as it stays true.
      </p>

      <div className="row">
        {(['open', 'dismissed', 'resolved'] as const).map((s) => (
          <button
            key={s}
            className={status === s ? undefined : 'link-button'}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
        <span className="muted">·</span>
        <button
          className="link-button"
          onClick={() => void act(() => api.post('/insights/refresh', {}))}
          disabled={busy}
        >
          {busy ? 'checking…' : 'check now'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {insights.length === 0 ? (
        <p className="muted">
          {status === 'open' ? 'Nothing needs attention.' : `No ${status} insights.`}
        </p>
      ) : (
        <ul className="insights">
          {insights.map((insight) => (
            <InsightRow
              key={insight.id}
              insight={insight}
              onDismiss={
                status === 'open'
                  ? () => void act(() => api.post(`/insights/${insight.id}/dismiss`, {}))
                  : undefined
              }
              onRestore={
                status === 'dismissed'
                  ? () => void act(() => api.post(`/insights/${insight.id}/restore`, {}))
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
