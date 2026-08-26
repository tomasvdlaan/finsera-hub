import { Link } from 'react-router-dom';
import { Card } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useShared } from '../../lib/useShared.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Act, ActRow } from '../../shell/ui/act.js';
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
      const { data, loading, error } = useShared<{ notes?: Note[] } | Note[]>('/meetings');
      const all = Array.isArray(data) ? data : (data?.notes ?? []);
      const rows = all.slice(0, Math.max(1, Math.min(15, Number(settings.rows) || 5)));
      return (
        <Card title="Recent meetings" to="/meetings" error={error}>
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

  /* ── Compound cards ───────────────────────────────────────────────────── */

  'meetings:open-actions': {
    title: 'Came out of a meeting',
    description: 'Action points a meeting proposed and nobody has decided on. Accept turns one into a card; dismiss drops it.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'meetings.write',
    Component: () => {
      const { data, loading, error } = useShared<
        Array<{ id: string; text: string; noteId: string; noteTitle: string; dueOn: string | null; projectId: string | null }>
      >('/meetings/open-actions');
      const projects = useShared<Array<{ id: string; name: string }>>('/crm/projects');
      const [gone, setGone] = useState<string[]>([]);
      const [linked, setLinked] = useState<Record<string, string>>({});
      const rows = (data ?? []).filter((a) => !gone.includes(a.id));

      return (
        /*
         * The one queue in the product where the items were written by a person in a room and
         * then left in limbo. A meeting that proposes eight actions and decides on none is a
         * meeting that produced nothing, and the deciding is two clicks that were previously
         * three screens away.
         */
        <Card
          error={error}
          title="Came out of a meeting"
          sub={loading ? undefined : rows.length === 0 ? undefined : `${rows.length} proposed, none decided`}
          tone={rows.length > 0 ? 'info' : undefined}
        >
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>Every action point from a meeting has been decided on.</Empty>
          ) : (
            <ul className="act-rows">
              {rows.slice(0, 4).map((a) => (
                <ActRow
                  key={a.id}
                  title={a.text}
                  meta={`${a.noteTitle}${a.dueOn ? ` · due ${a.dueOn}` : ''}`}
                >
                  {/*
                    A card needs a board, and a board belongs to a project.
                    
                    An action point from a note with no project cannot become a card — the
                    server says so, correctly, with a 400. Offering the button anyway would
                    mean a control whose only outcome is an error message, so the row asks the
                    question the server is going to ask and then the button works.
                    
                    Not a hypothetical: every stand-up note in this database was created
                    without a project, because the thing that starts a ceremony never sent one.
                  */}
                  {a.projectId || linked[a.noteId] ? (
                    <Act
                      variant="primary"
                      run={() => api.post(`/meetings/${a.noteId}/actions/${a.id}/accept`, {})}
                      onDone={() => setGone((all) => [...all, a.id])}
                    >
                      Make a card
                    </Act>
                  ) : (
                    <select
                      aria-label="Which project this meeting was about"
                      defaultValue=""
                      onChange={(ev) => {
                        const projectId = ev.target.value;
                        if (!projectId) return;
                        void api
                          .patch(`/meetings/${a.noteId}`, { projectId })
                          .then(() => setLinked((all) => ({ ...all, [a.noteId]: projectId })))
                          .catch(() => undefined);
                      }}
                    >
                      <option value="">Which project?</option>
                      {(projects.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  <Act
                    run={() => api.post(`/meetings/${a.noteId}/actions/${a.id}/dismiss`, {})}
                    onDone={() => setGone((all) => [...all, a.id])}
                  >
                    Drop
                  </Act>
                </ActRow>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  'meetings:next': {
    title: 'Next meeting',
    description: 'The next one on the calendar, and the button that opens the room and starts recording.',
    slot: 'dashboard',
    defaultSpan: 4,
    minSpan: 3,
    permission: 'meetings.write',
    Component: () => {
      const navigate = useNavigate();
      const { data, loading, error } = useShared<{ notes?: Note[] } | Note[]>('/meetings');
      const all = Array.isArray(data) ? data : (data?.notes ?? []);
      const today = new Date().toISOString().slice(0, 10);
      // Today onwards, soonest first. A meeting note is created before the meeting happens,
      // which is what makes this a schedule rather than a history.
      const next = all
        .filter((n) => (n.meetingDate ?? '') >= today)
        .sort((a, b) => (a.meetingDate ?? '').localeCompare(b.meetingDate ?? ''))[0];

      return (
        <Card title="Next meeting" live={next?.meetingDate === today} error={error}>
          {loading ? (
            <Skeleton height="3rem" />
          ) : !next ? (
            <Empty>Nothing scheduled.</Empty>
          ) : (
            <>
              <div className="card-clock" style={{ fontSize: '2rem' }}>
                {next.meetingDate === today ? 'Today' : day(next.meetingDate)}
              </div>
              <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>{next.title}</div>
              <div className="card-foot">
                <Act variant="primary" run={async () => navigate(`/meetings/${next.id}/room`)}>
                  Open the room
                </Act>
                <Act run={async () => navigate(`/meetings/${next.id}`)}>Notes</Act>
              </div>
            </>
          )}
        </Card>
      );
    },
  },
};
