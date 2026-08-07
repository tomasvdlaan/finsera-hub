import { Link } from 'react-router-dom';
import { Card } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useShared } from '../../lib/useShared.js';
import { ClientNotesWidget } from './ClientNotesWidget.js';
import type { SettingDef, WidgetDef } from '../types.js';

interface Note {
  id: string;
  title: string;
  meetingDate: string | null;
}

const ROWS: SettingDef = { key: 'rows', label: 'How many to show', type: 'count', min: 3, max: 15, default: 5 };

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

export const meetingsWidgets: Record<string, WidgetDef> = {
  'meetings:recent': {
    title: 'Recent meetings',
    description: 'The last few notes, newest first.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'meetings.read',
    settings: [ROWS],
    Component: ({ settings }) => {
      const { data, loading } = useShared<{ notes?: Note[] } | Note[]>('/meetings');
      const all = Array.isArray(data) ? data : (data?.notes ?? []);
      const rows = all.slice(0, Math.max(1, Math.min(15, Number(settings.rows) || 5)));
      return (
        <Card title="Recent meetings" to="/meetings">
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>No meetings yet.</Empty>
          ) : (
            <ul>
              {rows.map((n) => (
                <li key={n.id}>
                  <Link to={`/meetings/${n.id}`}>{n.title}</Link>
                  <span className="muted"> · {day(n.meetingDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  /*
   * The four adapters below wrap components that already existed and were already correct.
   *
   * They took `clientId` because the page that imported them knew it was a client page. The
   * slot passes `entityId`, which is the same value under a name that does not assume what
   * kind of page it is — so the wrapper is a rename, not a rewrite, and the widgets keep
   * working exactly as they did.
   */
  'meetings:client-notes': {
    title: 'Meetings',
    description: 'Recent meetings with this client.',
    slot: 'entity-page',
    entityTypes: ['client'],
    defaultSpan: 6,
    permission: 'meetings.read',
    Component: ({ entityId }) =>
      entityId ? (
        <Card title="Meetings">
          <ClientNotesWidget clientId={entityId} />
        </Card>
      ) : null,
  },
};
