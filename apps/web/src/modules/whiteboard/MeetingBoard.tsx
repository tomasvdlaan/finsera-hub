import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Button, Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { useCan } from '../../shell/useCan.js';
import { BoardCanvas } from './BoardCanvas.js';
import type { Board } from './types.js';

/**
 * The whiteboard for one meeting, as it appears inside the room.
 *
 * A board is created on demand rather than with every meeting: most meetings never draw
 * anything, and a library full of empty boards nobody opened would make the real ones hard to
 * find.
 *
 * Fills whatever it is given rather than setting its own height — in the room that is the whole
 * stage. The pop-out stays regardless: on two screens the best place for a board is the other
 * one, and no amount of in-room layout beats that.
 */
export function MeetingBoard({ entityId }: { entityId?: string }) {
  const { can } = useCan();
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!entityId) return;
    api
      .get<Board[]>(`/whiteboard/boards?meetingId=${encodeURIComponent(entityId)}`)
      .then((rows) => setBoard(rows[0] ?? null))
      .catch((e: Error) => setError(e.message));
  }, [entityId]);

  const start = useCallback(async () => {
    if (!entityId) return;
    setCreating(true);
    try {
      setBoard(
        await api.post<Board>('/whiteboard/boards', {
          meetingId: entityId,
          title: 'Meeting whiteboard',
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [entityId]);

  if (!entityId) return null;
  if (error) return <p className="error">{error}</p>;
  if (board === undefined) return <Skeleton height="6rem" />;

  if (board === null) {
    return (
      <Empty
        action={
          can('whiteboard.write') && (
            <Button variant="primary" onClick={start} disabled={creating}>
              Start a whiteboard
            </Button>
          )
        }
      >
        Nothing has been drawn for this meeting.
      </Empty>
    );
  }

  return (
    <div className="wb-surface wb-surface-fill">
      <Link to={`/whiteboards/${board.id}`} className="wb-popout">
        Open full screen
      </Link>
      <BoardCanvas boardId={board.id} readOnly={!can('whiteboard.write')} />
    </div>
  );
}
