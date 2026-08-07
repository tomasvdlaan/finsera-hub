import { useState } from 'react';
import { api } from '../../lib/api.js';

interface Line {
  id: string;
  at: number;
  text: string;
  speaker?: string;
}

interface Transcript {
  id: string;
  startedAt: string;
  durationSeconds: number;
  provider: string;
  lines: Line[];
  costCents: number;
}

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * What was said, kept out of the note.
 *
 * Transcripts used to be appended to the note body, where they were indexed for search
 * and read by the assistant — so a note that had been recorded was mostly speech, and
 * asking what was decided returned the moment somebody nearly decided it. They are their
 * own records now, and this is where you read them.
 *
 * Fetched on first open rather than with the note. A transcript is the largest thing the
 * module stores and most visits to a note are not to re-read an hour of speech.
 */
export function Transcripts({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<Transcript[]>();
  const [error, setError] = useState<string>();

  const load = () => {
    if (items || error) return;
    api
      .get<Transcript[]>(`/meetings/${noteId}/transcripts`)
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  };

  return (
    <section>
      <h2>Transcript</h2>
      <details onToggle={(e) => e.currentTarget.open && load()}>
        <summary>What was said</summary>

        {error && <p className="error">{error}</p>}
        {!items && !error && <p className="muted">Loading…</p>}
        {items?.length === 0 && (
          <p className="muted">
            This meeting has not been recorded. Start a recording above and what is said
            ends up here, separately from your notes.
          </p>
        )}

        {items?.map((t, i) => (
          <div key={t.id} style={{ marginTop: '1rem' }}>
            <h3>
              Recording {i + 1} <span className="muted">{when(t.startedAt)}</span>{' '}
              {/* 'backfilled' means it was moved out of the note body, where transcripts
                  used to live — its start time is the note's, not the recording's. */}
              <span className="badge">
                {t.provider === 'recall'
                  ? 'bot'
                  : t.provider === 'backfilled'
                    ? 'moved from the note'
                    : 'browser'}
              </span>
            </h3>
            <table>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id}>
                    <td data-align="action" style={{ verticalAlign: 'top' }}>
                      <span className="muted">{clock(l.at)}</span>
                    </td>
                    <td>
                      {l.speaker && <strong>{l.speaker}: </strong>}
                      {l.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </details>
    </section>
  );
}
