import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import type { Board } from './types.js';

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(new Date(iso)) : null;

/** A whiteboard, as the assistant shows it. */
export function BoardChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    api
      .get<Board>(`/whiteboard/boards/${id}`)
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [id]);

  const drawn = day(board?.lastActivityAt ?? null);

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">whiteboard</span>
        <Link to={urlPath}>{board?.title ?? displayName}</Link>
      </div>
      <div className="muted">{drawn ? `last drawn on ${drawn}` : 'nothing drawn yet'}</div>
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}
