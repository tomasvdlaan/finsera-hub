import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { ChatWidgetProps } from '../types.js';
import type { NoteDetail } from './types.js';

/** A meeting note, as the assistant shows it. */
export function NoteChatCard({ id, displayName, urlPath }: ChatWidgetProps) {
  const [note, setNote] = useState<NoteDetail | null>(null);

  useEffect(() => {
    api.get<NoteDetail>(`/meetings/${id}`).then(setNote).catch(() => setNote(null));
  }, [id]);

  const open = note?.actionItems.filter((a) => a.status === 'proposed').length ?? 0;

  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">meeting</span>
        <Link to={urlPath}>{note?.title ?? displayName}</Link>
      </div>
      {note && (
        <div className="muted">
          {note.meetingDate}
          {open > 0 && ` · ${open} action point${open === 1 ? '' : 's'} awaiting a decision`}
        </div>
      )}
      <div className="chat-card-actions">
        <Link to={urlPath}>open</Link>
      </div>
    </div>
  );
}
