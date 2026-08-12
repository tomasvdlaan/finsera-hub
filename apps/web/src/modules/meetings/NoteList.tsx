import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import type { Client, Project } from '../crm/types.js';
import type { Note, NoteRow, Template } from './types.js';
import { Empty } from '../../shell/ui/primitives.js';
import { Card, Figure } from '../../shell/ui/card.js';
import { Act, ActRow } from '../../shell/ui/act.js';

interface OpenAction {
  id: string;
  text: string;
  source: 'typed' | 'ai';
  dueOn: string | null;
  noteId: string;
  noteTitle: string;
  meetingDate: string;
}

interface OpenSprint {
  id: string;
  name: string;
  projectId: string;
  state: 'planned' | 'active' | 'completed';
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

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * How long the room was open, or null when it never was.
 *
 * Null is the ordinary case for a note typed up after the fact, and it is why this returns
 * null rather than nought: a meeting shown as lasting zero minutes reads as one that went
 * badly wrong, when in truth nobody used the room.
 */
function lengthOf(n: Note): number | null {
  if (!n.startedAt || !n.endedAt) return null;
  const mins = Math.round((Date.parse(n.endedAt) - Date.parse(n.startedAt)) / 60_000);
  return Number.isFinite(mins) && mins >= 0 ? mins : null;
}

const hhmm = (mins: number) => (mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`);

/**
 * The first thing the note actually says.
 *
 * Headings do not count. Every ceremony body starts life as the template's skeleton — `##
 * Round the table`, `## Blockers` — so a summary taken from line one would report the
 * skeleton back as content, and every unwritten stand-up in the database would look written.
 * That distinction is the single most useful thing this list can draw: of the ceremony notes
 * held so far, the bodies are still the headings they were seeded with.
 */
function saidSomething(body: string): string | null {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    // A bullet or checkbox with nothing after it is still an empty template.
    const stripped = line.replace(/^([-*+]|\d+\.)\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
    if (!stripped) continue;
    /*
     * A label with nothing after it is not content either.
     *
     * The seeded stand-up puts `Yesterday:` / `Today:` / `Blockers:` under each person, and
     * reading line one meant every untouched stand-up in the database summarised itself as
     * "Yesterday:" — which is exactly the flattery this function exists to refuse. Skipping
     * the label reveals the truth underneath: nobody typed anything.
     */
    const inline = plainText(stripped);
    if (!inline || /^[^:]{0,24}:$/.test(inline)) continue;
    return inline;
  }
  return null;
}

/**
 * Markdown as a reader would hear it.
 *
 * The body is Markdown and this is one line of prose, so the marks have to go — a summary
 * reading `Needs ==urgent review==.` shows the syntax instead of the emphasis it stands for.
 * Deliberately not a parser: this only ever has to survive one line and lose no words.
 */
function plainText(s: string) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What kind of meeting this was, for the thirty-day breakdown. */
function kindOf(n: Note): 'standup' | 'sprint' | 'client' | 'other' {
  if (n.template === 'daily_standup') return 'standup';
  if (n.template && isCeremony(n.template)) return 'sprint';
  if (n.clientId) return 'client';
  return 'other';
}

const KINDS = [
  { key: 'standup', label: 'Stand-ups' },
  { key: 'sprint', label: 'Planning, review & retro' },
  { key: 'client', label: 'Client conversations' },
  { key: 'other', label: 'Everything else' },
] as const;

/** Initials for the avatar stack. Two letters at most — three is a monogram, not a face. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function Faces({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 4);
  return (
    <span className="faces" title={names.join(', ')}>
      {shown.map((n, i) => (
        <span className="face" key={n + i} data-i={i % 4}>
          {initials(n)}
        </span>
      ))}
      {names.length > shown.length && <span className="face face-more">+{names.length - shown.length}</span>}
    </span>
  );
}

type Filter = 'all' | 'recorded' | 'client';

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

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openActions, setOpenActions] = useState<OpenAction[]>([]);
  const [active, setActive] = useState<ActiveSession[]>([]);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<Record<string, unknown>> | null>(null);
  const [searching, setSearching] = useState(false);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [sprints, setSprints] = useState<OpenSprint[]>([]);
  /** What the next ceremony is about: `sprint:<id>` or `project:<id>`. */
  const [context, setContext] = useState('');
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Each independently: a failing endpoint should cost its own section, not the page.
    const fetchInto = <T,>(path: string, set: (v: T) => void, fallback: T) =>
      api
        .get<T>(path)
        .then(set)
        .catch(() => set(fallback));

    void fetchInto<NoteRow[]>('/meetings', setNotes, []);
    void fetchInto<OpenAction[]>('/meetings/open-actions', setOpenActions, []);
    void fetchInto<ActiveSession[]>('/meetings/live', setActive, []);
  }, []);

  useEffect(() => {
    load();
    api.get<Client[]>('/crm/clients').then(setClients).catch(() => setClients([]));
    api.get<Project[]>('/crm/projects').then(setProjects).catch(() => setProjects([]));
    /*
     * Running *and* planned.
     *
     * Filtering to active alone meant the sprint you had just finished planning was invisible
     * to the picker until somebody started it — so the ceremony that created it could not be
     * followed by one about it. A closed sprint is a different matter: nothing new is about it.
     */
    api
      .get<OpenSprint[]>('/scrum/sprints')
      .then((all) => setSprints(all.filter((s) => s.state !== 'completed')))
      .catch(() => setSprints([]));
    api.get<Template[]>('/meetings/templates').then(setTemplates).catch(() => setTemplates([]));
    // Your own name, so a stand-up's per-person block is headed with it rather than "me".
    api.get<{ displayName: string }>('/core/me').then(setMe).catch(() => setMe(null));
  }, [load]);

  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  /*
   * Default to the running sprint when there is exactly one, which is the ordinary morning.
   * Only ever sets a default — once you have chosen, it stops interfering.
   */
  useEffect(() => {
    if (context) return;
    const running = sprints.filter((s) => s.state === 'active');
    const pick = running.length === 1 ? running[0] : sprints.length === 1 ? sprints[0] : null;
    if (pick) setContext(`sprint:${pick.id}`);
    else if (sprints.length === 0 && projects.length === 1) setContext(`project:${projects[0]!.id}`);
  }, [sprints, projects, context]);

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
      /*
       * What the ceremony is about, which this never sent.
       *
       * Every ceremony note in the database had a null project — not through neglect, but
       * because this call only ever posted a title, a template and an attendee. A note with
       * no project cannot turn an action point into a task, cannot find a board and appears
       * on nobody's timeline, so the ceremony left no trace anywhere but itself.
       *
       * Naming a sprint is enough: the server fills the project in from it.
       */
      const [kind, id] = context.split(':');
      const note = await api.post<Note>('/meetings', {
        title: `${t.label} — ${new Date().toISOString().slice(0, 10)}`,
        template: t.name,
        sprintId: kind === 'sprint' ? id : null,
        projectId: kind === 'project' ? id : null,
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
    setSearching(true);
    try {
      setHits(await api.get(`/meetings/search?q=${encodeURIComponent(query)}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /* ---- what the list is showing ---------------------------------------------------- */

  const shown = useMemo(
    () =>
      notes.filter((n) =>
        filter === 'recorded' ? n.transcribedAt !== null : filter === 'client' ? n.clientId !== null : true,
      ),
    [notes, filter],
  );

  /*
   * This week means the last seven days, not the calendar week.
   *
   * A Monday morning under a calendar rule shows an empty "this week" while Thursday's
   * planning meeting sits under "earlier" — technically true and useless on the one day you
   * are most likely to be looking for it.
   */
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), []);
  const thisWeek = shown.filter((n) => n.meetingDate >= weekAgo);
  const earlier = shown.filter((n) => n.meetingDate < weekAgo).slice(0, 12);

  /* ---- the last thirty days --------------------------------------------------------- */

  const stats = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const window = notes.filter((n) => n.meetingDate >= cutoff);
    const byKind = new Map<string, number>();
    let total = 0;
    let unwritten = 0;
    let timed = 0;
    for (const n of window) {
      const mins = lengthOf(n);
      if (mins === null) continue;
      timed += 1;
      total += mins;
      byKind.set(kindOf(n), (byKind.get(kindOf(n)) ?? 0) + mins);
      if (!saidSomething(n.body)) unwritten += mins;
    }
    return { rooms: window.length, timed, total, byKind, unwritten };
  }, [notes]);

  const decide = (a: OpenAction, verb: 'accept' | 'dismiss') => async () => {
    await api.post(`/meetings/${a.noteId}/actions/${a.id}/${verb}`, {});
  };

  const drop = (id: string) => () => setOpenActions((prev) => prev.filter((a) => a.id !== id));

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Every room keeps its own notes, action points and transcript."
      />
      {error && <p className="error">{error}</p>}

      {/* Something is being recorded. Nothing else on this page matters as much. */}
      {active.map((s) => (
        <div className="statusbar statusbar-live" data-span={12} key={s.noteId}>
          <span className="statusbar-dot" />
          <strong>{noteById.get(s.noteId)?.title ?? 'A meeting'}</strong>
          <span className="muted">
            since {new Date(s.startedAt).toTimeString().slice(0, 5)} ·{' '}
            {s.provider === 'recall' ? 'bot in the call' : 'this browser'}
          </span>
          <Link to={`/meetings/${s.noteId}/room`}>Go to the room</Link>
        </div>
      ))}

      {/* ---- start a room ---------------------------------------------------------- */}
      <div className="startbar" data-span={12}>
        <span className="startbar-label">Start a room</span>
        <div className="startbar-chips">
          {ceremonies.map((t) => (
            <button
              key={t.name}
              type="button"
              className="ceremony"
              disabled={busy !== null}
              onClick={() => void startCeremony(t)}
              title={t.description}
            >
              <span className="ceremony-label">{busy === t.name ? 'Opening…' : t.label}</span>
              <span className="ceremony-box">{t.timeboxMinutes} min</span>
            </button>
          ))}
          <button
            type="button"
            className="ceremony ceremony-other"
            aria-expanded={composing}
            onClick={() => setComposing((v) => !v)}
          >
            <span className="ceremony-label">Something else</span>
          </button>
        </div>
        {/*
          What the ceremony is about — a sprint or a project, never a client.

          A stand-up belongs to a sprint and a sprint belongs to a project; asking which client
          it was for would be the wrong question three mornings in four. The client is asked
          for in the composer below instead, where it is the right one.
        */}
        <label className="startbar-context">
          <span className="faint">About</span>
          <select value={context} onChange={(e) => setContext(e.target.value)}>
            {sprints.map((s) => (
              <option key={s.id} value={`sprint:${s.id}`}>
                {s.name} · {projectName.get(s.projectId) ?? 'sprint'}
                {s.state === 'planned' ? ' (not started)' : ''}
              </option>
            ))}
            {projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.name}
                {sprints.some((s) => s.projectId === p.id) ? ' (no sprint)' : ''}
              </option>
            ))}
            <option value="">Nothing in particular</option>
          </select>
        </label>
      </div>

      {composing && (
        <form className="startbar-compose" data-span={12} onSubmit={(e) => void createConversation(e)}>
          <input
            autoFocus
            placeholder="What is this meeting about?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="act" data-variant="primary" disabled={!title.trim() || busy !== null}>
            Create
          </button>
          {conversations.map((t) => (
            <button
              key={t.name}
              type="button"
              className="act"
              disabled={!title.trim() || busy !== null}
              title={t.description}
              onClick={(e) => void createConversation(e, t.name)}
            >
              {t.label}
            </button>
          ))}
        </form>
      )}

      {/* ---- the two columns -------------------------------------------------------- */}
      <div className="meet-body" data-span={12}>
        <div className="meet-main">
          {openActions.length > 0 && (
            <Card
              tone="warning"
              title="Still open from past meetings"
              sub={`${openActions.length} ${openActions.length === 1 ? 'action point is' : 'action points are'} waiting on a decision from you`}
            >
              <ul className="act-rows">
                {openActions.map((a) => (
                  <ActRow
                    key={a.id}
                    title={a.text}
                    meta={
                      <>
                        {/*
                          Where a suggestion came from, always. `ai` means a model heard this
                          in the room and wrote it down — which is exactly why it is proposed
                          and not on the board.
                        */}
                        <span className="tag" data-kind={a.source}>
                          {a.source === 'ai' ? 'Heard by the agent' : 'You wrote it'}
                        </span>{' '}
                        {/*
                          A ceremony names itself after its date — "Daily stand-up —
                          2026-07-31" — so printing the date beside it read it back twice.
                        */}
                        {a.noteTitle.replace(/\s*[—-]\s*\d{4}-\d{2}-\d{2}\s*$/, '')} ·{' '}
                        {a.meetingDate}
                        {a.dueOn && ` · due ${a.dueOn}`}
                      </>
                    }
                  >
                    <Act variant="primary" run={decide(a, 'accept')} onDone={drop(a.id)}>
                      Put on the board
                    </Act>
                    <Act
                      run={decide(a, 'dismiss')}
                      onDone={drop(a.id)}
                      confirm={`Drop "${a.text}"? It stays on the note, but nothing will chase it.`}
                    >
                      Drop
                    </Act>
                    <Link className="act" data-variant="quiet" to={`/meetings/${a.noteId}`}>
                      Open note
                    </Link>
                  </ActRow>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Meetings"
            aside={
              <div className="chip-row">
                {(['all', 'recorded', 'client'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={filter === f ? 'chip chip-on' : 'chip'}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'recorded' ? 'Recorded' : 'With clients'}
                  </button>
                ))}
              </div>
            }
          >
            {shown.length === 0 ? (
              <Empty>
                {notes.length === 0
                  ? 'No meetings yet. Start one above and the note writes itself as you go.'
                  : 'No meetings match that filter.'}
              </Empty>
            ) : (
              <>
                {[
                  { label: 'This week', rows: thisWeek },
                  { label: 'Earlier', rows: earlier },
                ]
                  .filter((g) => g.rows.length > 0)
                  .map((group) => (
                    <div className="meet-group" key={group.label}>
                      <div className="meet-group-label">{group.label}</div>
                      {group.rows.map((n) => {
                        const mins = lengthOf(n);
                        const said = saidSomething(n.body);
                        const d = new Date(`${n.meetingDate}T00:00:00`);
                        return (
                          <Link className="meet-row" key={n.id} to={`/meetings/${n.id}`} data-kind={kindOf(n)}>
                            <span className="meet-date">
                              <small>{DAY[d.getDay()]}</small>
                              <strong>{d.getDate()}</strong>
                            </span>
                            <span className="meet-main-col">
                              <span className="meet-title">
                                {/* The date is already the badge to the left of this. */}
                                {n.title.replace(/\s*[—-]\s*\d{4}-\d{2}-\d{2}\s*$/, '')}
                                {n.transcribedAt && <span className="tag" data-kind="rec">Recorded</span>}
                                {n.clientId && <span className="tag">{clientName.get(n.clientId) ?? 'Client'}</span>}
                                {n.status === 'final' && <span className="tag" data-kind="final">Final</span>}
                              </span>
                              {/*
                                The body's first real sentence, or the fact that there is not
                                one. An unwritten note is the outcome worth surfacing: the room
                                was open, the time was spent, and nothing came out of it.
                              */}
                              <span className="meet-said" data-empty={said === null || undefined}>
                                {said ?? 'No notes written — nothing was captured in this room.'}
                              </span>
                            </span>
                            <span className="meet-figures">
                              <span className="meet-fig">
                                <small>Actions</small>
                                <strong data-open={n.actionsOpen > 0 || undefined}>
                                  {n.actionsTotal === 0
                                    ? '—'
                                    : n.actionsOpen > 0
                                      ? `${n.actionsOpen} open`
                                      : n.actionsTotal}
                                </strong>
                              </span>
                              <span className="meet-fig">
                                <small>Length</small>
                                <strong>{mins === null ? '—' : hhmm(mins)}</strong>
                              </span>
                            </span>
                            <Faces names={n.attendeeNames} />
                          </Link>
                        );
                      })}
                    </div>
                  ))}
              </>
            )}
          </Card>
        </div>

        {/* ---- the rail ------------------------------------------------------------- */}
        <div className="meet-rail">
          <Card title="Search what was discussed">
            <form onSubmit={(e) => void search(e)} className="meet-search">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setHits(null);
                }}
                placeholder="e.g. what did we promise about the migration?"
              />
              <button type="submit" className="act" data-variant="primary" disabled={searching}>
                {searching ? '…' : 'Search'}
              </button>
            </form>
            {hits === null ? (
              /*
                Both halves of this are true and worth saying. The search runs keywords and,
                when embeddings are configured, meaning as well. Transcripts are excluded by
                construction — they live in their own table precisely because a thousand words
                of half-sentences buried the note they belonged to.
              */
              <p className="card-note">
                Searches note titles and bodies by word and by meaning. Transcripts are left out on
                purpose — they bury everything else.
              </p>
            ) : hits.length === 0 ? (
              <Empty>Nothing matched.</Empty>
            ) : (
              <ul className="meet-hits">
                {hits.map((h) => (
                  <li key={String(h.id)}>
                    <Link to={`/meetings/${String(h.id)}`}>{String(h.title)}</Link>
                    <small className="card-meta">
                      {String(h.meeting_date)} · {h.match === 'semantic' ? 'by meaning' : 'by word'}
                    </small>
                    <p>{highlighted(String(h.snippet ?? ''))}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Last 30 days">
            {stats.timed === 0 ? (
              <Empty>
                No meeting has been held in a room yet, so there is no length to report.
              </Empty>
            ) : (
              <>
                <Figure
                  label="In meetings"
                  value={(stats.total / 60).toFixed(1).replace('.', ',')}
                  unit="h"
                  note={`${stats.rooms} ${stats.rooms === 1 ? 'meeting' : 'meetings'}${
                    stats.timed < stats.rooms ? ` · ${stats.rooms - stats.timed} never opened a room` : ''
                  }`}
                />
                <ul className="meet-bars">
                  {KINDS.filter((k) => (stats.byKind.get(k.key) ?? 0) > 0).map((k) => {
                    const mins = stats.byKind.get(k.key)!;
                    return (
                      <li key={k.key}>
                        <span className="meet-bar-head">
                          <span>{k.label}</span>
                          <strong>{hhmm(mins)}</strong>
                        </span>
                        <span className="meet-bar" data-kind={k.key}>
                          <span style={{ width: `${(mins / stats.total) * 100}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {stats.unwritten > 0 && (
                  /*
                    Time spent in rooms that produced no written note. Not a judgement — a
                    stand-up rarely needs one — but it is the number that says whether the
                    notes on this page are a record of the work or a record of a few meetings.
                  */
                  <p className="card-note">
                    {hhmm(stats.unwritten)} of that produced no written notes.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
