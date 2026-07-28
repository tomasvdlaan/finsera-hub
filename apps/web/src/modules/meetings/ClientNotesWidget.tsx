import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import type { Note } from './types.js';

/** Recent meetings with one client — contributed to CRM's client page via the manifest. */
export function ClientNotesWidget({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    api
      .get<Note[]>(`/meetings?clientId=${clientId}`)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [clientId]);

  if (notes.length === 0) {
    return (
      <p className="muted">
        No meetings recorded — <Link to="/meetings">start a note</Link>.
      </p>
    );
  }

  return (
    <ul className="cards">
      {notes.slice(0, 6).map((note) => (
        <li key={note.id}>
          <Link to={`/meetings/${note.id}`}>{note.title}</Link>{' '}
          <span className="muted">{note.meetingDate}</span>
        </li>
      ))}
    </ul>
  );
}
