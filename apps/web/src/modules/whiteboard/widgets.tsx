import { Link } from 'react-router-dom';
import { Card } from '../../shell/ui/card.js';
import { Skeleton } from '../../shell/ui/data.js';
import { Empty } from '../../shell/ui/primitives.js';
import { useShared } from '../../lib/useShared.js';
import type { SettingDef, WidgetDef } from '../types.js';
import { prefetchBoardEditor } from './BoardCanvas.js';
import { MeetingBoard } from './MeetingBoard.js';
import type { Board } from './types.js';

const ROWS: SettingDef = {
  key: 'rows',
  label: 'How many to show',
  type: 'count',
  min: 3,
  max: 15,
  default: 5,
};

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : '—';

export const whiteboardWidgets: Record<string, WidgetDef> = {
  'whiteboard:recent': {
    title: 'Recent whiteboards',
    description: 'What has been drawn on lately.',
    slot: 'dashboard',
    defaultSpan: 6,
    minSpan: 4,
    permission: 'whiteboard.read',
    settings: [ROWS],
    Component: ({ settings }) => {
      const { data, loading, error } = useShared<Board[]>('/whiteboard/boards');
      const rows = (data ?? []).slice(
        0,
        Math.max(1, Math.min(15, Number(settings.rows) || 5)),
      );
      return (
        <Card title="Recent whiteboards" to="/whiteboards" error={error}>
          {loading ? (
            <Skeleton height="4rem" />
          ) : rows.length === 0 ? (
            <Empty>Nothing drawn yet.</Empty>
          ) : (
            <ul>
              {rows.map((b) => (
                <li key={b.id}>
                  <Link to={`/whiteboards/${b.id}`}>{b.title}</Link>
                  <span className="muted"> · {day(b.lastActivityAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    },
  },

  'whiteboard:meeting-board': {
    title: 'Whiteboard',
    description: 'Draw over a screenshot while you talk about it.',
    slot: 'meeting-room',
    defaultSpan: 12,
    permission: 'whiteboard.read',
    entityTypes: ['meeting_note'],
    // The editor is a large lazy chunk; a room that knows a board is one click away warms it.
    prefetch: prefetchBoardEditor,
    Component: ({ entityId }) => <MeetingBoard entityId={entityId} />,
  },
};
