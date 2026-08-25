import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Card } from '../../shell/ui/card.js';
import { Badge } from '../../shell/ui/primitives.js';
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
      return `/money/invoices/${insight.subjectId}`;
    case 'quote':
      return `/money/quotes/${insight.subjectId}`;
    case 'contract':
      return `/money/contracts/${insight.subjectId}`;
    case 'project':
      return `/projects/${insight.subjectId}`;
    case 'task':
      return `/tasks/${insight.subjectId}`;
    case 'sprint':
      return `/board/sprints/${insight.subjectId}`;
    default:
      return null;
  }
}

/**
 * What a severity looks like, in the two places a row can say it.
 *
 * Both were saying nothing. The badge was a bare `.badge`, which is the neutral grey one, so
 * "urgent" and "attention" rendered identically — on the one screen in the product whose entire
 * job is to rank. And the coloured left edge was written as `border-left-color` on
 * `li.insight.sev-urgent` (0,2,1), which loses to the `border` shorthand in `ul.insights
 * li.insight` (0,2,2) eight lines above it, so every row drew the plain `--border`.
 *
 * `data-edge` is the utility that already exists for exactly this — it paints the edge as a
 * pseudo-element, so there is no shorthand for a neighbouring rule to overwrite and no
 * specificity race to lose. `info` gets no edge: it is the absence of a reason to look.
 */
const SEVERITY: Record<Insight['severity'], { edge?: 'danger' | 'warning'; tone: 'danger' | 'warning' | 'neutral' }> = {
  urgent: { edge: 'danger', tone: 'danger' },
  attention: { edge: 'warning', tone: 'warning' },
  info: { tone: 'neutral' },
};

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
  const sev = SEVERITY[insight.severity];
  return (
    <li className="insight" data-edge={sev.edge}>
      <div>
        <strong>{path ? <Link to={path}>{insight.title}</Link> : insight.title}</strong>
        {insight.detail && <div className="muted">{insight.detail}</div>}
      </div>
      <div className="insight-actions">
        <Badge tone={sev.tone}>{insight.severity}</Badge>
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

interface Request {
  id: string;
  subject: string;
  client_name: string;
  client_id: string;
}

interface Blocked {
  id: string;
  title: string;
  blockedReason: string | null;
  daysInColumn: number;
}

/**
 * One queue for everything that wants a person.
 *
 * There were three, and the split was by which module happened to raise the item rather than
 * by anything the reader cares about: insights on /insights, client requests on
 * /portal/requests, and work blocked on you nowhere at all — `blocked_on_user_id` had been
 * written since blockers were built and no screen had ever read it.
 *
 * Three inboxes is none. The question is "what wants me", and it does not have a module.
 */
export function Insights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [status, setStatus] = useState<'open' | 'dismissed' | 'resolved'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);

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

  /*
   * Loaded independently, and failing quietly.
   *
   * Three sources behind one page: with Promise.all a portal outage empties the whole inbox,
   * including the insights that have nothing to do with it.
   */
  useEffect(() => {
    api.get<Request[]>('/portal-preview/requests').then(setRequests).catch(() => setRequests([]));
    api
      .get<Blocked[]>('/scrum/tasks?blockedOnUserId=me')
      .then(setBlocked)
      .catch(() => setBlocked([]));
  }, []);

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
      <PageHeader
        title="Inbox"
        subtitle="Everything waiting on you, from wherever it came. Nothing here has been acted on — no message was sent and no record changed. An item whose cause goes away disappears on its own; dismissing one keeps it hidden for as long as it stays true."
      />

      {/*
        Blocked work first.

        These are the only items in the inbox where somebody else has stopped and named you as
        the reason. An insight can wait a day; a colleague cannot.
      */}
      {blocked.length > 0 && (
        <Card
          span={12}
          tone="danger"
          title={`${blocked.length} ${blocked.length === 1 ? 'card is' : 'cards are'} blocked on you`}
          sub="Someone stopped and put your name on it."
        >
          <ul>
            {blocked.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                {t.blockedReason && <span className="muted"> — {t.blockedReason}</span>}
                <span className="muted"> · {t.daysInColumn}d</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {requests.length > 0 && (
        <Card
          span={12}
          title={`${requests.length} client ${requests.length === 1 ? 'request' : 'requests'}`}
          sub="Written by someone outside the business. Deciding what it becomes is why it is not a card already."
          to="/portal/requests"
        >
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                <Link to="/portal/requests">{r.subject}</Link>
                <span className="muted"> — {r.client_name}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
