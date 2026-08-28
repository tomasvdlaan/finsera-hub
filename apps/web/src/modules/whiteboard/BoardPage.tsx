import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Button } from '../../shell/ui/primitives.js';
import { useCan } from '../../shell/useCan.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { BoardCanvas } from './BoardCanvas.js';
import type { Board } from './types.js';
import './board.css';

/**
 * A whiteboard, taking the whole window.
 *
 * Deliberately thin: it owns the chrome around the canvas — where back goes, the title, who is
 * on it — and knows nothing about how the drawing works. Everything that needs Excalidraw is
 * behind `BoardCanvas`, which is what keeps the editor out of this route's chunk.
 */
export function BoardPage() {
  const { id = '' } = useParams();
  const { can, ready } = useCan();

  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');

  useDocumentTitle(board?.title ?? 'Whiteboard');

  useEffect(() => {
    api
      .get<Board>(`/whiteboard/boards/${id}`)
      .then((b) => {
        setBoard(b);
        setTitle(b.title);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const commitTitle = useCallback(async () => {
    setRenaming(false);
    const trimmed = title.trim();
    if (!board || !trimmed || trimmed === board.title) {
      setTitle(board?.title ?? '');
      return;
    }
    try {
      setBoard(await api.patch<Board>(`/whiteboard/boards/${id}`, { title: trimmed }));
    } catch (e) {
      setError((e as Error).message);
      setTitle(board.title);
    }
  }, [board, id, title]);

  if (error) {
    return (
      <div className="wb-page wb-page-error">
        <p className="error">{error}</p>
        <Link to="/whiteboards">Back to whiteboards</Link>
      </div>
    );
  }

  /*
   * Wait for `useCan` before mounting the canvas.
   *
   * `can` answers false until the capability list has loaded, so mounting early would put
   * everybody in a read-only board for a moment and then flip it under them mid-stroke.
   */
  if (!board || !ready) return <div className="wb-page" />;

  const readOnly = !can('whiteboard.write');

  return (
    <div className="wb-page">
      <header className="wb-bar">
        <Link to="/whiteboards" className="wb-back">
          <span aria-hidden="true">←</span> Whiteboards
        </Link>

        {renaming ? (
          <input
            className="wb-title-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setTitle(board.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <Button
            variant="ghost"
            className="wb-title"
            disabled={readOnly}
            onClick={() => setRenaming(true)}
          >
            {board.title}
          </Button>
        )}

        {readOnly && <span className="badge">read only</span>}
      </header>

      <div className="wb-surface">
        <BoardCanvas boardId={id} readOnly={readOnly} title={board.title} />
      </div>
    </div>
  );
}
