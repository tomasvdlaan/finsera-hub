import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import type { Client, Project } from '../crm/types.js';
import type { Note, Template } from './types.js';

interface OpenAction {
  id: string;
  text: string;
  source: 'typed' | 'ai';
  dueOn: string | null;
  noteId: string;
  noteTitle: string;
  meetingDate: string;
}

interface ActiveSession {
  noteId: string;
  startedAt: string;
  provider: string;
}

/** The ceremonies, in the order a sprint runs them, ahead of the older client templates. */
const CEREMONY_ORDER = ['daily_standup', 'sprint_planning', 'sprint_review', 'retrospective'];

const isCeremony = (name: string) => CEREMONY_ORDER.includes(name);

/**
 * Render ts_headline's `<b>` markers as elements rather than as markup.
 *
 * Postgres returns the matched words wrapped in `<b>`. Setting that as innerHTML would be the
 * easy way and would also mean any HTML in a note body executes when it turns up in a search
 * result — self-inflicted today, and a way for one colleague's note to attack another as soon
 * as there is more than one of us. Splitting on the tag keeps the emphasis and keeps the text
 * text.
 */
function highlighted(snippet: string) {
  return snippet.split(/<b>|<\/b>/).map((part, i) =>
    // Odd indices are what sat inside the tags.
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

const dayLabel = (iso: string) => {
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return 'today';
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === yesterday) return 'yesterday';
  return iso;
};

/**
 * The meetings hub.
 *
 * It used to be a list with a create form on top, which answered "what meetings exist" — a
 * question nobody has. The ones that get asked are: is something being recorded right now,
 * what did I commit to and never deal with, and can I start the stand-up without filling in a
 * form first. So those are the sections, in that order.
 *
 * Unfinished business leads because it is the failure this platform is most prone to. An
 * action point that was said out loud and never accepted or dismissed is the most expensive
 * kind of nothing here: it is written down, so it feels handled, and it is on no board, so
 * nothing was ever going to remind you.
 */
export function NoteList() {
  useDocumentTitle('Meetings');
  const navigate = useNavigate();

  const [notes, setNotes] = useState<Note[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openActions, setOpenActions] = useState<OpenAction[]>([]);
  const [active, setActive] = useState<ActiveSession[]>([]);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<Record<string, unknown>> | null>(null);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Each independently: a failing endpoint should cost its own section, not the page.
    const fetchInto = <T,>(path: string, set: (v: T) => void, fallback: T) =>
      api
        .get<T>(path)
        .then(set)
        .catch(() => set(fallback));

    void fetchInto<Note[]>('/meetings', setNotes, []);
    void fetchInto<OpenAction[]>('/meetings/open-actions', setOpenActions, []);
    void fetchInto<ActiveSession[]>('/meetings/live', setActive, []);
  }, []);

  useEffect(() => {
    load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
    api.get<Template[]>('/meetings/templates').then(setTemplates).catch(() => setTemplates([]));
    // Your own name, so a stand-up's per-person block is headed with it rather than "me".
    api.get<{ displayName: string }>('/core/me').then(setMe).catch(() => setMe(null));
  }, [load]);

  const clientName = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const ceremonies = useMemo(
    () =>
      templates
        .filter((t) => isCeremony(t.name))
        .sort((a, b) => CEREMONY_ORDER.indexOf(a.name) - CEREMONY_ORDER.indexOf(b.name)),
    [templates],
  );
  const conversations = useMemo(() => templates.filter((t) => !isCeremony(t.name)), [templates]);

  /**
   * Start a ceremony and go straight into the room.
   *
   * One click. The old form wanted a title, a client and a template before it would do
   * anything, which for a stand-up you run every morning is three answers you already know —
   * and the room is where you were going anyway.
   */
  const startCeremony = async (t: Template) => {
    setBusy(t.name);
    setError(null);
    try {
      const note = await api.post<Note>('/meetings', {
        title: `${t.label} — ${new Date().toISOString().slice(0, 10)}`,
        template: t.name,
        // Yourself, so the per-person block has a heading and the consent gate has somebody
        // to ask. Anyone else gets added in the room.
        attendees: [{ name: me?.displayName ?? 'Me' }],
      });
      navigate(`/meetings/${note.id}/room`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createConversation = async (e: FormEvent, templateName?: string) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy('custom');
    setError(null);
    try {
      // A note picks up its project automatically when the client has exactly one, which
      // is the common case and the difference between two clicks and four.
      const forClient = projects.filter((p) => p.clientId === clientId);
      const note = await api.post<Note>('/meetings', {
        title: title.trim(),
        clientId: clientId || null,
        projectId: forClient.length === 1 ? forClient[0]!.id : null,
        template: templateName || undefined,
      });
      navigate(`/meetings/${note.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return setHits(null);
    setHits(await api.get(`/meetings/search?q=${encodeURIComponent(query)}`));
  };

  const today = new Date().toISOString().slice(0, 10);
  const todays = notes.filter((n) => n.meetingDate === today);
  const recent = notes.filter((n) => n.meetingDate !== today).slice(0, 8);

  return (
    <>
      <h1>Meetings</h1>
      {error && <p className="error">{error}</p>}

      {/* Something is being recorded. Nothing else on this page matters as much. */}
      {active.length > 0 && (
        <section>
          <h2>Happening now</h2>
          {active.map((s) => (
            <div className="statusbar statusbar-live" key={s.noteId}>
              <span className="statusbar-dot" />
              <strong>{noteById.get(s.noteId)?.title ?? 'A meeting'}</strong>
              <span className="muted">
                since {new Date(s.startedAt).toTimeString().slice(0, 5)} ·{' '}
                {s.provider === 'recall' ? 'bot in the call' : 'this browser'}
              </span>
              <Link to={`/meetings/${s.noteId}/room`}>Go to the room</Link>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>Start</h2>
        <div className="ceremony-row">
          {ceremonies.map((t) => (
            <button
              key={t.name}
              className="ceremony"
              disabled={busy !== null}
              onClick={() => void startCeremony(t)}
              title={t.description}
            >
              <span className="ceremony-label">
                {busy === t.name ? 'Opening…' : t.label}
              </span>
              <span className="muted">{t.timeboxMinutes} min</span>
            </button>
          ))}
        </div>
        <p className="muted">
          Opens straight into the room with today&rsquo;s date and you as an attendee. Add
          anyone else once you are in.
        </p>
      </section>

      {/*
        The point of the page.

        A commitment nobody decided on is invisible everywhere else: it is not a task, so no
        board shows it, and the note it lives on scrolled away weeks ago.
      */}
      <section>
        <h2>
          Waiting on a decision{' '}
          {openActions.length > 0 && <span className="muted">{openActions.length}</span>}
        </h2>
        {openActions.length === 0 ? (
          <p className="muted">
            Nothing outstanding. Every action point from every meeting has been made a task or
            dismissed.
          </p>
        ) : (
          <table>
            <tbody>
              {openActions.map((a) => (
                <tr key={a.id}>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }} className="muted">
                    {dayLabel(a.meetingDate)}
                  </td>
                  <td>
                    {a.source === 'ai' && <span className="tag">suggested</span>}{' '}
                    <Link to={`/meetings/${a.noteId}`}>{a.text}</Link>
                    <div className="muted">{a.noteTitle}</div>
                  </td>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                    {a.dueOn && (
                      <span className={a.dueOn < today ? 'tag overdue' : 'tag'}>{a.dueOn}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {todays.length > 0 && (
        <section>
          <h2>Today</h2>
          <ul className="cards">
            {todays.map((n) => (
              <li key={n.id}>
                <Link to={`/meetings/${n.id}`}>{n.title}</Link>
                {n.template && <span className="tag"> {n.template.replace(/_/g, ' ')}</span>}
                {n.clientId && <span className="muted"> · {clientName[n.clientId]}</span>}
                {n.status === 'draft' && (
                  <>
                    {' · '}
                    <Link to={`/meetings/${n.id}/room`}>room</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Recent</h2>
        {recent.length === 0 ? (
          <p className="muted">No earlier meetings.</p>
        ) : (
          <table>
            <tbody>
              {recent.map((n) => (
                <tr key={n.id}>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }} className="muted">
                    {n.meetingDate}
                  </td>
                  <td>
                    <Link to={`/meetings/${n.id}`}>{n.title}</Link>
                    {n.clientId && <span className="muted"> · {clientName[n.clientId]}</span>}
                  </td>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                    {n.transcribedAt && <span className="tag">recorded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Look something up</h2>
        <form onSubmit={(e) => void search(e)}>
          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search what was discussed…"
              aria-label="Search notes"
              style={{ flex: 1, minWidth: 220 }}
            />
            <button type="submit">Search</button>
          </div>
        </form>
        <p className="muted">
          Keyword and meaning, over what was written down. What was <em>said</em> lives in the
          transcript on each note and is deliberately not searched — it buried everything else.
        </p>
        {hits && hits.length === 0 && <p className="muted">Nothing matched.</p>}
        {hits && hits.length > 0 && (
          <ul className="cards">
            {hits.map((h) => (
              <li key={String(h.id)}>
                <Link to={`/meetings/${String(h.id)}`}>{String(h.title)}</Link>
                <span className="muted"> · {String(h.meeting_date)}</span>
                {h.match === 'semantic' && <span className="tag"> by meaning</span>}
                {Boolean(h.snippet) && <div className="muted">{highlighted(String(h.snippet))}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Something else</h2>
        <form onSubmit={(e) => void createConversation(e)}>
          <div className="row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is the meeting about?"
              aria-label="Meeting title"
              style={{ flex: 1, minWidth: 220 }}
            />
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy !== null || !title.trim()}>
              New note
            </button>
          </div>
        </form>
        <div className="row">
          {conversations.map((t) => (
            <button
              key={t.name}
              className="link-button"
              disabled={busy !== null || !title.trim()}
              onClick={(e) => void createConversation(e, t.name)}
              title={t.description}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
