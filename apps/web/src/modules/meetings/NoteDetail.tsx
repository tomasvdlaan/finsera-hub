import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Timeline } from '../../shell/Timeline.js';
import type { Client } from '../crm/types.js';
import { LivePanel } from './LivePanel.js';
import { RichEditor } from './RichEditor.js';
import type { NoteDetail as Detail } from './types.js';

/**
 * A one-field inline form.
 *
 * Replaces window.prompt, which browsers suppress after a few uses and block entirely in
 * some contexts — so "add an attendee" silently did nothing. It is also simply better:
 * the field stays open for the next entry, which is how these are actually used.
 */
function AddInline({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    setBusy(true);
    try {
      await onAdd(text);
      setValue(''); // ready for the next one
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

export function NoteDetail() {
  const { confirm } = useDialog();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Detail | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
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
        {note.status === 'draft' && (
          <button onClick={() => void act(() => api.post(`/meetings/${id}/finalise`, {}))}>
            Mark done
          </button>
        )}
        <button
          className="link-button destructive"
          onClick={() =>
            void act(async () => {
              const go = await confirm({
                title: 'Delete this note?',
                body: 'The transcript, agenda and any AI notes go with it. This cannot be undone.',
                confirmLabel: 'Delete note',
                destructive: true,
              });
              if (!go) return;
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
                  className="link-button destructive"
                  onClick={() => void act(() => api.del(`/meetings/${id}/agenda/${item.id}`))}
                  aria-label={`Remove ${item.title}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddInline
          label="New agenda item"
          placeholder="Add an agenda item…"
          onAdd={(title) => act(() => api.post(`/meetings/${id}/agenda`, { title }))}
        />
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
              (note.transcriptCostCents === 0
                ? ' · cost under € 0,01'
                : ` · cost ${new Intl.NumberFormat('nl-NL', {
                    style: 'currency',
                    currency: 'EUR',
                  }).format(note.transcriptCostCents / 100)}`)}
          </p>
        )}
      </section>

      <section>
        <h2>Notes</h2>
        {/*
          Always editable. A note is a working document — the thing you do with it is
          write in it, and a click between reading and writing is a click before every
          thought. Autosave makes the mode meaningless anyway.
        */}
        <RichEditor markdown={body} onChange={onBodyChange} />
        <p className="muted">
          Saves as you type. Paste or drop an image straight in. Markdown shortcuts work
          too — <code>##</code> for a heading, <code>-</code> for a bullet,{' '}
          <code>- [ ]</code> for a checkbox.
        </p>
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
        <AddInline
          label="New action point"
          placeholder="Add an action point…"
          onAdd={(text) => act(() => api.post(`/meetings/${id}/actions`, { text }))}
        />
        {!note.projectId && note.actionItems.length > 0 && (
          <p className="muted">
            Link this note to a project to turn action points into tasks.
          </p>
        )}
      </section>

      <section>
        <h2>Attendees</h2>
        {note.unconsentedPresent.length > 0 && (
          <p className="error">
            {note.unconsentedPresent.map((p) => p.name).join(', ')}{' '}
            {note.unconsentedPresent.length === 1 ? 'is' : 'are'} in the meeting and{' '}
            {note.unconsentedPresent.length === 1 ? 'has' : 'have'} not been asked about
            recording. The consent check runs before the bot joins, so it cannot cover
            somebody who arrived afterwards.
          </p>
        )}
        {note.attendees.length === 0 ? (
          <p className="muted">Nobody recorded.</p>
        ) : (
          <ul className="cards">
            {note.attendees.map((person) => (
              <li key={person.id}>
                {person.name}
                {person.email && <span className="muted"> · {person.email}</span>}{' '}
                {person.detectedAt && (
                  <span className="badge billed" title="Seen in the meeting by the bot">
                    present
                  </span>
                )}{' '}
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
                    className="link-button destructive"
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
        <AddInline
          label="New attendee"
          placeholder="Who is in the meeting?"
          onAdd={(name) => act(() => api.post(`/meetings/${id}/attendees`, { name }))}
        />
        <p className="muted">
          Consent is asked per person and recorded with a timestamp. Recording needs every
          attendee to have agreed. Anyone the bot sees join is added here automatically, so
          the list ends up being who was actually there rather than who was expected.
        </p>
      </section>

      <section>
        <h2>Discussion</h2>
        <Comments entityId={id} />
      </section>

      <section>
        <h2>Timeline</h2>
        <Timeline entityId={id} />
      </section>
    </>
  );
}
