import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PageHeader } from '../../shell/ui/layout.js';
import { Button, Empty } from '../../shell/ui/primitives.js';
import { Skeleton } from '../../shell/ui/data.js';
import { useCan } from '../../shell/useCan.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import type { Board } from './types.js';

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : null;

export function BoardLibrary() {
  useDocumentTitle('Whiteboards');
  const navigate = useNavigate();
  const { can } = useCan();

  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .get<Board[]>('/whiteboard/boards')
      .then((rows) => {
        setBoards(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const board = await api.post<Board>('/whiteboard/boards', {});
      navigate(`/whiteboards/${board.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Whiteboards"
        subtitle="Sketches, screenshots drawn over, and whatever was on the wall."
        actions={
          can('whiteboard.write') && (
            <Button variant="primary" onClick={create} disabled={creating}>
              New whiteboard
            </Button>
          )
        }
      />

      {error && <p className="error">{error}</p>}

      {boards === null ? (
        <Skeleton height="8rem" />
      ) : boards.length === 0 ? (
        <Empty
          action={
            can('whiteboard.write') && (
              <Button variant="primary" onClick={create} disabled={creating}>
                New whiteboard
              </Button>
            )
          }
        >
          No whiteboards yet.
        </Empty>
      ) : (
        <ul className="wb-grid">
          {boards.map((b) => {
            const drawn = day(b.lastActivityAt);
            return (
              <li key={b.id} className="wb-card">
                <Link to={`/whiteboards/${b.id}`}>
                  {b.thumbnailKey ? (
                    <img
                      className="wb-card-preview"
                      src={`/api/whiteboard/images/${encodeURIComponent(b.thumbnailKey)}`}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    // Same box, so a board that has never been drawn on does not move the grid.
                    <div className="wb-card-preview" aria-hidden="true" />
                  )}
                  <span className="wb-card-title">{b.title}</span>
                </Link>
                <span className="muted">{drawn ? `last drawn on ${drawn}` : 'empty'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
