import { Link } from 'react-router-dom';
import { Card } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useShared } from '../../lib/useShared.js';
import { InsightRow, type Insight } from './Insights.js';
import { DecisionQueue } from './DecisionQueue.js';
import type { SettingDef, WidgetDef } from '../types.js';

interface Blocked {
  id: string;
  title: string;
  blockedReason: string | null;
  daysInColumn: number;
}

const ROWS: SettingDef = { key: 'rows', label: 'How many to show', type: 'count', min: 3, max: 20, default: 5 };

const limit = (settings: Record<string, string>, fallback = 5) =>
  Math.max(1, Math.min(20, Number(settings.rows) || fallback));

export const insightsWidgets: Record<string, WidgetDef> = {
  'insights:decision-queue': {
    title: 'Needs a decision',
    description: 'The front of the queue, one at a time, with what is behind it — and buttons rather than a link.',
    slot: 'dashboard',
    // Full width and nothing else. A hero at half width is a card with big type in it.
    defaultSpan: 12,
    minSpan: 12,
    permission: 'insights.read',
    Component: () => <DecisionQueue />,
  },

  'insights:needs-you': {
    title: 'Needs you',
    description: 'Open findings from the sweep — nothing here has been acted on.',
    slot: 'dashboard',
    defaultSpan: 8,
    minSpan: 6,
    permission: 'insights.read',
    settings: [ROWS],
    Component: ({ settings }) => {
      const { data, loading, error } = useShared<Insight[]>('/insights?status=open');
      const rows = (data ?? [])
        // The severity that never reaches "Needs you" is `info`, by an earlier decision that
        // is worth keeping: a queue that includes things nobody has to do stops being a queue.
        .filter((i) => i.severity === 'urgent' || i.severity === 'attention')
        .slice(0, limit(settings));
      return (
        <Card
          error={error}
          title="Needs you"
          sub={loading ? undefined : `${rows.length} open`}
          tone={rows.some((i) => i.severity === 'urgent') ? 'danger' : undefined}
          to="/insights"
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>Nothing needs a decision.</Empty>
          ) : (
            <ul className="insights">
              {rows.map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  'insights:blocked-on-me': {
    title: 'Blocked on you',
    description: 'Work somebody else stopped and put your name on.',
    // Hidden until there is something to show: somebody else has to exist to block you.
    needs: ['people', 2],
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'scrum.tasks.read',
    Component: () => {
      const { data, loading, error } = useShared<Blocked[]>('/scrum/tasks?blockedOnUserId=me');
      const rows = data ?? [];
      return (
        /*
         * Always tinted when it has anything in it, unlike the other queues.
         *
         * Everything else on a dashboard is a machine noticing something. These are the items
         * where a person stopped working and named you as the reason, and that is a different
         * kind of urgent — an insight can wait a day.
         */
        <Card title="Blocked on you" tone={rows.length > 0 ? 'danger' : undefined} error={error}>
          {loading ? (
            <Skeleton height="3rem" />
          ) : rows.length === 0 ? (
            <Empty>Nobody is waiting on you.</Empty>
          ) : (
            <ul>
              {rows.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  {t.blockedReason && <span className="muted"> — {t.blockedReason}</span>}
                  <span className="muted"> · {t.daysInColumn}d</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },
};
