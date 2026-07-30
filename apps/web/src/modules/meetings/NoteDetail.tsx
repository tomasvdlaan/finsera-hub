import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Timeline } from '../../shell/Timeline.js';
import type { Client } from '../crm/types.js';
import { LivePanel } from './LivePanel.js';
import { RichEditor } from './RichEditor.js';
import { Transcripts } from './Transcripts.js';
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
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const n = await api.get<Detail>(`/meetings/${id}`);
      setNote(n);
      /*
       * The body is not taken from here any more.
       *
       * This used to hand `n.body` to the editor, guarded by a dirty check, because a reload
       * triggered by accepting an action point would otherwise replace what you were typing.
       * The editor now holds the document over its own connection, so a note refetched for
       * its action points and attendees cannot touch the text at all.
       */
      if (n.clientId) setClient(await api.get<Client>(`/crm/clients/${n.clientId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    // Needed to offer the project a note has to be linked to before an action point can
    // become a task; a missing list costs the selector, not the page.
    api
      .get<Array<{ id: string; name: string }>>('/crm/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
    api
      .get<Array<{ id: string; displayName: string }>>('/core/users')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      // No flush first any more: reloading the note no longer touches the editor, so there
      // is nothing racing the refetch.
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
      </div>

      <div className="row">
        {/*
          The way into the room, and the primary action while a meeting is happening. This
          page is for reading and correcting a note afterwards; the room is for running the
          meeting, which needs the whole screen.
        */}
        <Link to={`/meetings/${id}/room`} className="button-link">
          Open the room
        </Link>
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
        <RichEditor noteId={id} />
        <p className="muted">
          Saves as you type, and shows what anyone else is writing as they write it. Paste or
          drop an image straight in. Markdown shortcuts work too — <code>##</code> for a
          heading, <code>-</code> for a bullet, <code>- [ ]</code> for a checkbox.
        </p>
      </section>

      {/* Below the notes, because the notes are the point and the transcript is the
          evidence. It used to be inside them, which had it exactly backwards. */}
      <Transcripts noteId={id} />

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
                {/* Owner and due date, set here rather than after acceptance. Both columns
                    and both ends of the wire have existed since this module was written —
                    acceptance has always passed them into the task — but nothing could
                    write them, so every task made from a meeting arrived unowned and
                    undated. Editing stops at acceptance, where the task takes over. */}
                <div className="row" style={{ marginTop: '0.35rem' }}>
                  <select
                    aria-label={`Assign "${item.text}"`}
                    value={item.assigneeId ?? ''}
                    onChange={(e) =>
                      void act(() =>
                        api.patch(`/meetings/${id}/actions/${item.id}`, {
                          assigneeId: e.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">Nobody yet</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    aria-label={`Due date for "${item.text}"`}
                    value={item.dueOn ?? ''}
                    onChange={(e) =>
                      void act(() =>
                        api.patch(`/meetings/${id}/actions/${item.id}`, {
                          dueOn: e.target.value || null,
                        }),
                      )
                    }
                  />
                </div>
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
        {/* The instruction used to stand here on its own — "link this note to a project to
            turn action points into tasks" — with nothing on the page that could link one.
            Accepting an action point is refused by the server without a project, so the
            control belongs where you find out you need it. */}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <label htmlFor="note-project" className="muted">
            Project
          </label>
          <select
            id="note-project"
            value={note.projectId ?? ''}
            onChange={(e) =>
              void act(() =>
                api.patch(`/meetings/${id}`, { projectId: e.target.value || null }),
              )
            }
          >
            <option value="">Not linked</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/* Only while something is still waiting to become a task. An accepted point
              already is one, so saying it is "needed" then is simply untrue. */}
          {!note.projectId && proposed.length > 0 && (
            <span className="muted">— needed before an action point can become a task</span>
          )}
        </div>
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
