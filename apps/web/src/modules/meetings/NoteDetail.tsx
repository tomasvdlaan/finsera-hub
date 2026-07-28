import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Timeline } from '../../shell/Timeline.js';
import type { Client } from '../crm/types.js';
import { LivePanel } from './LivePanel.js';
import { Markdown } from './Markdown.js';
import type { NoteDetail as Detail } from './types.js';

export function NoteDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Detail | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const n = await api.get<Detail>(`/meetings/${id}`);
      setNote(n);
      setBody(n.body);
      setDirty(false);
      if (n.clientId) setClient(await api.get<Client>(`/crm/clients/${n.clientId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveBody = useCallback(
    async (next: string) => {
      await api.patch(`/meetings/${id}`, { body: next });
      setDirty(false);
    },
    [id],
  );

  /**
   * Autosave while typing.
   *
   * Notes are taken during a meeting, where remembering to press save is exactly the
   * attention you do not have. Debounced so a burst of typing is one write.
   */
  const onBodyChange = (next: string) => {
    setBody(next);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveBody(next).catch(() => undefined), 1200);
  };

  useEffect(() => () => (saveTimer.current ? clearTimeout(saveTimer.current) : undefined), []);

  if (!note) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const proposed = note.actionItems.filter((a) => a.status === 'proposed');
  const settled = note.actionItems.filter((a) => a.status !== 'proposed');

  return (
    <>
      <p>
        <Link to="/meetings">← Meetings</Link>
        {client && (
          <>
            {' · '}
            <Link to={`/crm/clients/${client.id}`}>{client.name}</Link>
          </>
        )}
      </p>
      <h1>{note.title}</h1>

      <div className="row">
        <span className="badge">{note.status}</span>
        <span className="muted">{note.meetingDate}</span>
        {note.template && <span className="badge">{note.template.replace(/_/g, ' ')}</span>}
        {dirty && <span className="muted">saving…</span>}
      </div>

      <div className="row">
        <button className="link-button" onClick={() => setEditing((e) => !e)}>
          {editing ? 'done editing' : 'edit note'}
        </button>
        {note.status === 'draft' && (
          <button onClick={() => void act(() => api.post(`/meetings/${id}/finalise`, {}))}>
            Mark done
          </button>
        )}
        <button
          className="link-button"
          onClick={() =>
            void act(async () => {
              if (!window.confirm('Delete this note?')) return;
              await api.del(`/meetings/${id}`);
              navigate('/meetings');
            })
          }
        >
          delete
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Agenda</h2>
        {note.agenda.length === 0 ? (
          <p className="muted">No agenda.</p>
        ) : (
          <ul className="agenda">
            {note.agenda.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.covered}
                    onChange={(e) =>
                      void act(() =>
                        api.post(`/meetings/${id}/agenda/${item.id}/covered`, {
                          covered: e.target.checked,
                        }),
                      )
                    }
                  />{' '}
                  <span className={item.covered ? 'muted' : undefined}>{item.title}</span>
                </label>
                <button
                  className="link-button"
                  onClick={() => void act(() => api.del(`/meetings/${id}/agenda/${item.id}`))}
                  aria-label={`Remove ${item.title}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="link-button"
          onClick={() =>
            void act(async () => {
              const title = window.prompt('Agenda item?');
              if (title?.trim()) await api.post(`/meetings/${id}/agenda`, { title: title.trim() });
            })
          }
        >
          + add agenda item
        </button>
      </section>

      <section>
        <h2>Live</h2>
        <LivePanel
          noteId={id}
          canRecord={note.everyoneConsented}
          onFinished={() => void load()}
        />
        {note.transcribedAt && (
          <p className="muted">
            Transcribed {note.transcribedAt.slice(0, 16).replace('T', ' ')}
            {note.transcriptCostCents != null &&
              ` · cost ${new Intl.NumberFormat('nl-NL', {
                style: 'currency',
                currency: 'EUR',
              }).format(note.transcriptCostCents / 100)}`}
          </p>
        )}
      </section>

      <section>
        <h2>Notes</h2>
        {editing ? (
          <>
            <textarea
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              aria-label="Note body"
              rows={20}
              style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
            />
            <p className="muted">
              Markdown. Headings with <code>##</code>, lists with <code>-</code>, checkboxes
              with <code>- [ ]</code>, and tables with pipes. Saves as you type.
            </p>
          </>
        ) : (
          <Markdown>{body}</Markdown>
        )}
      </section>

      <section>
        <h2>Action points</h2>
        {proposed.length === 0 && settled.length === 0 && (
          <p className="muted">None yet.</p>
        )}
        {proposed.length > 0 && (
          <ul className="cards">
            {proposed.map((item) => (
              <li key={item.id}>
                <span>{item.text}</span>{' '}
                {item.source === 'ai' && (
                  <span className="badge" title="Suggested by the assistant">
                    suggested
                  </span>
                )}
                {item.dueOn && <span className="muted"> · due {item.dueOn}</span>}
                <div className="row">
                  <button
                    className="link-button"
                    onClick={() =>
                      void act(() => api.post(`/meetings/${id}/actions/${item.id}/accept`, {}))
                    }
                  >
                    make it a task
                  </button>
                  <button
                    className="link-button"
                    onClick={() =>
                      void act(() => api.post(`/meetings/${id}/actions/${item.id}/dismiss`, {}))
                    }
                  >
                    dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {settled.length > 0 && (
          <ul className="cards">
            {settled.map((item) => (
              <li key={item.id} className="muted">
                <span className="badge">{item.status}</span> {item.text}
                {item.taskId && (
                  <>
                    {' · '}
                    <Link to={`/scrum/tasks/${item.taskId}`}>open the task</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          className="link-button"
          onClick={() =>
            void act(async () => {
              const text = window.prompt('Action point?');
              if (text?.trim()) await api.post(`/meetings/${id}/actions`, { text: text.trim() });
            })
          }
        >
          + add action point
        </button>
        {!note.projectId && note.actionItems.length > 0 && (
          <p className="muted">
            Link this note to a project to turn action points into tasks.
          </p>
        )}
      </section>

      <section>
        <h2>Attendees</h2>
        {note.attendees.length === 0 ? (
          <p className="muted">Nobody recorded.</p>
        ) : (
          <ul className="cards">
            {note.attendees.map((person) => (
              <li key={person.id}>
                {person.name}
                {person.email && <span className="muted"> · {person.email}</span>}{' '}
                {person.consent === 'granted' && <span className="badge billed">consented</span>}
                {person.consent === 'declined' && (
                  <span className="badge priority-urgent">declined</span>
                )}
                {!person.consent && <span className="badge">not asked</span>}
                <div className="row">
                  <button
                    className="link-button"
                    onClick={() =>
                      void act(() =>
                        api.post(`/meetings/${id}/attendees/${person.id}/consent`, {
                          consent: 'granted',
                        }),
                      )
                    }
                  >
                    consented
                  </button>
                  <button
                    className="link-button"
                    onClick={() =>
                      void act(() =>
                        api.post(`/meetings/${id}/attendees/${person.id}/consent`, {
                          consent: 'declined',
                        }),
                      )
                    }
                  >
                    declined
                  </button>
                  <button
                    className="link-button"
                    onClick={() =>
                      void act(() => api.del(`/meetings/${id}/attendees/${person.id}`))
                    }
                  >
                    remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          className="link-button"
          onClick={() =>
            void act(async () => {
              const name = window.prompt('Who attended?');
              if (name?.trim()) await api.post(`/meetings/${id}/attendees`, { name: name.trim() });
            })
          }
        >
          + add attendee
        </button>
        <p className="muted">
          Consent is asked per person and recorded with a timestamp. Recording a meeting
          needs every attendee to have agreed.
        </p>
      </section>

      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} />
      </section>
    </>
  );
}
