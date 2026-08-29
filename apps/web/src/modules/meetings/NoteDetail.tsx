import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from '../../shell/ui/layout.js';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Comments } from '../../shell/Comments.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { Timeline } from '../../shell/Timeline.js';
import type { Client } from '../crm/types.js';
import type { Sprint } from '../scrum/types.js';
import { LivePanel } from './LivePanel.js';
import { PlanTheSprint, SprintLine } from './PlanTheSprint.js';
import { RichEditor } from './RichEditor.js';
import { Transcripts } from './Transcripts.js';
import type { ActionItem, NoteDetail as Detail, Template } from './types.js';
import { Badge, Button, Empty, Panel, Status } from '../../shell/ui/primitives.js';

/**
 * A meeting, as the person who was in it needs it.
 *
 * The page used to be one flat stack of twelve equal sections in the order the data model
 * happens to list them: agenda, the bot, the note, the transcript, then — fifth, below the
 * evidence — the action points the meeting existed to produce. That order is right for
 * exactly nobody. A meeting is three jobs at three different times, and the same layout was
 * being asked to serve all of them at once.
 *
 * So the page has a phase, and the phase decides the order. Before it happens you are
 * preparing: the agenda, who is coming, whether the bot may record. While it runs you are in
 * the room, and this page's only job is to get you back there. Afterwards you are writing up
 * and settling what you owe, so the outcome comes first and the preparation folds away. Once
 * it is done the whole thing is a record to read, share and print.
 *
 * Nothing is hidden behind a click that was not hidden before — folded sections are still on
 * the page and still open in one keystroke. What changes is which of them you land on.
 */
type Phase = 'scheduled' | 'live' | 'writeup' | 'done';

/**
 * Which of the three jobs this page is doing.
 *
 * `startedAt` and `endedAt` are both null for a note written up afterwards rather than held
 * in a room, which is ordinary and is why the date is the tie-breaker rather than a default:
 * a note dated tomorrow with no room is being prepared, and the same note dated today is
 * being written up. Reading "never started" as "scheduled" would leave every hand-written
 * note permanently pretending the meeting had not happened yet.
 */
function phaseOf(note: Detail, today: string): Phase {
  if (note.status === 'final') return 'done';
  if (note.startedAt && !note.endedAt) return 'live';
  if (note.endedAt) return 'writeup';
  return note.meetingDate > today ? 'scheduled' : 'writeup';
}

/** Whole minutes between two instants, or null when the room never ran. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null;
}

/** `95` → `1h 35m`. Minutes alone stop being readable somewhere around an hour. */
function humanMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

interface Me {
  id: string;
  displayName: string;
  role: string;
}

/**
 * A section that is on the page but not in the way.
 *
 * `<details>` rather than a state hook and a chevron: it is the platform's disclosure, it is
 * reachable from the keyboard and findable by in-page search without any work, and browsers
 * expand it to print. A hand-rolled one gets all three of those wrong quietly.
 */
function Fold({
  title,
  aside,
  open,
  children,
}: {
  title: string;
  /** A count or a status, shown on the closed summary — the reason to open it. */
  aside?: ReactNode;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel fold" open={open}>
      <summary className="panel-head fold-head">
        <h2>{title}</h2>
        {aside}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

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

/**
 * What each phase puts where.
 *
 * Two columns rather than one stack, because the page is a document *and* everything around
 * it. `main` is what you are doing right now and `rail` is what you are doing it against —
 * which of them a section belongs to is the phase's decision, so the agenda is the work while
 * the meeting is being prepared and reference material once it has happened.
 *
 * Every phase lists every section across the two, so nothing can be lost by being forgotten
 * here — a section that does not apply renders nothing and takes no room. Below the grid's
 * breakpoint the two columns become one and the reading order is main, then rail.
 */
const ORDER: Record<Phase, { main: string[]; rail: string[] }> = {
  // Nothing has happened yet. The work is getting the meeting ready to run.
  scheduled: {
    main: ['agenda', 'note'],
    rail: ['people', 'live', 'sprint', 'outcome', 'evidence', 'discussion', 'timeline'],
  },
  // It is happening somewhere else. This page's whole job is the way back into the room.
  live: {
    main: ['live', 'note'],
    rail: ['agenda', 'outcome', 'people', 'sprint', 'evidence', 'discussion', 'timeline'],
  },
  // It happened. What you owe comes first, then the write-up; the preparation moves aside.
  writeup: {
    main: ['outcome', 'note'],
    rail: ['sprint', 'agenda', 'live', 'evidence', 'people', 'discussion', 'timeline'],
  },
  // A record to read, share and print.
  done: {
    main: ['outcome', 'note'],
    rail: ['evidence', 'live', 'sprint', 'agenda', 'people', 'discussion', 'timeline'],
  },
};

export function NoteDetail() {
  const { confirm } = useDialog();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<Detail | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; displayName: string }>>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
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
      setSprint(n.sprintId ? await api.get<Sprint>(`/scrum/sprints/${n.sprintId}`) : null);
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
    // Who is reading. Without it the page can describe what the meeting decided but not what
    // any of it has to do with you, which is the question you actually came with.
    api.get<Me>('/core/me').then(setMe).catch(() => setMe(null));
    // For the timebox. A ceremony that is meant to take fifteen minutes and took fifty is the
    // most useful thing the page can say about how it went, and the number was already here.
    api.get<Template[]>('/meetings/templates').then(setTemplates).catch(() => setTemplates([]));
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      // No flush first any more: reloading the note no longer touches the editor, so there
      // is nothing racing the refetch.
      await fn();
      // One reload does it: the ledger of what earlier meetings left owed comes back on the
      // note itself, so carrying a commitment forward refreshes the list it came out of.
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p.displayName])),
    [people],
  );

  /*
   * What earlier meetings about this work left owed.
   *
   * Worked out by the server now — `openBefore` in meetings.service. It was assembled here from
   * `/meetings/open-actions`, which only ever knew about action points nobody had decided on,
   * and the half that was missing is the half that matters: a commitment accepted onto the board
   * a month ago and never finished. Nothing brought that back into the conversation that would
   * have noticed, which is most of what a recurring meeting is for.
   */
  const owed = note?.openBefore ?? [];

  if (!note) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const phase = phaseOf(note, today);

  const proposed = note.actionItems.filter((a) => a.status === 'proposed');
  const settled = note.actionItems.filter((a) => a.status !== 'proposed');
  const mine = me ? note.actionItems.filter((a) => a.assigneeId === me.id && a.status !== 'dismissed') : [];

  const covered = note.agenda.filter((a) => a.covered).length;
  const ran = minutesBetween(note.startedAt, note.endedAt);
  const timebox = templates.find((t) => t.name === note.template)?.timeboxMinutes ?? null;
  const over = ran != null && timebox != null && ran > timebox ? ran - timebox : null;
  const consentMissing = note.unconsentedPresent.length > 0 || !note.everyoneConsented;

  /** One proposed point, with the two fields that decide who it lands on. */
  const decide = (item: ActionItem) => (
    <li key={item.id}>
      <div className="owed-text">
        <span>{item.text}</span>{' '}
        {item.source === 'ai' && (
          <Badge tone="brand" title="Suggested by the assistant">suggested</Badge>
        )}{' '}
        {/* A commitment being asked about for the second time reads differently from a new
            one, and the difference is the point of carrying it rather than retyping it. */}
        {item.carriedFrom && (
          <Badge tone="warning" title="Carried over from an earlier meeting">carried over</Badge>
        )}
      </div>
      {/* Owner and due date, set here rather than after acceptance. Both columns and both
          ends of the wire have existed since this module was written — acceptance has always
          passed them into the task — but nothing could write them, so every task made from a
          meeting arrived unowned and undated. Editing stops at acceptance, where the task
          takes over. */}
      <div className="row">
        <select
          aria-label={`Assign "${item.text}"`}
          value={item.assigneeId ?? ''}
          onChange={(e) =>
            void act(() =>
              api.patch(`/meetings/${id}/actions/${item.id}`, { assigneeId: e.target.value || null }),
            )
          }
        >
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <input
          type="date"
          aria-label={`Due date for "${item.text}"`}
          value={item.dueOn ?? ''}
          onChange={(e) =>
            void act(() =>
              api.patch(`/meetings/${id}/actions/${item.id}`, { dueOn: e.target.value || null }),
            )
          }
        />
        <Button size="sm" onClick={() => void act(() => api.post(`/meetings/${id}/actions/${item.id}/accept`, {}))}>
          Make it a task
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/meetings/${id}/actions/${item.id}/dismiss`, {}))}>
          Dismiss
        </Button>
      </div>
    </li>
  );

  const sections: Record<string, ReactNode> = {
    /*
     * What the meeting produced, and what of it is yours.
     *
     * First on the page once the meeting has happened, because it is the only part of a
     * meeting that outlives it. It used to be fifth, under the transcript — the output filed
     * beneath the evidence for it.
     */
    outcome: (
      <Panel
        key="outcome"
        title="Follow-through"
        action={
          proposed.length > 0 ? (
            <Badge tone="warning">{proposed.length} to decide</Badge>
          ) : settled.length > 0 ? (
            <Badge tone="ok">all settled</Badge>
          ) : undefined
        }
      >
        {/* Yours, first and separately. Everything else on this page is about the meeting;
            this is the one part that is about you, and burying it in a list of everybody's
            actions is how a commitment gets made and not noticed. */}
        {mine.length > 0 && (
          <div className="owed owed-mine">
            <h3>Yours</h3>
            <ul>
              {mine.map((a) => (
                <li key={a.id}>
                  <Status value={a.status === 'accepted' ? 'accepted' : 'proposed'} />{' '}
                  <span>{a.text}</span>
                  {a.dueOn && <span className="muted"> · due {a.dueOn}</span>}
                  {a.taskId && <> · <Link to={`/tasks/${a.taskId}`}>open the task</Link></>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Still owed from earlier meetings about this work. For a stand-up this is most of the
            reason to look at the page at all: the thing that was blocked yesterday. */}
        {owed.length > 0 && (
          <div className="owed owed-carry">
            <h3>Still open from before</h3>
            <ul>
              {owed.map((c) => (
                <li key={c.id}>
                  <span>{c.text}</span>
                  <span className="muted">
                    {' '}· <Link to={`/meetings/${c.noteId}`}>{c.noteTitle}</Link>, {c.meetingDate}
                    {c.assigneeId && peopleById.has(c.assigneeId) ? ` · ${peopleById.get(c.assigneeId)}` : ''}
                    {c.dueOn ? ` · due ${c.dueOn}` : ''}
                  </span>{' '}
                  {/*
                   * The two states get different answers, which is the whole reason they are
                   * told apart. An undecided one can be picked up here and settled. An undone
                   * one is already a card — offering to carry it would put the same work on the
                   * board twice, so it gets the card instead.
                   */}
                  {c.state === 'undone' ? (
                    <>
                      <Badge>on the board</Badge>{' '}
                      {c.taskId && <Link to={`/tasks/${c.taskId}`}>open the task</Link>}
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(() => api.post(`/meetings/${id}/actions/${c.id}/carry`, {}))
                      }
                    >
                      Carry over
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {proposed.length === 0 && settled.length === 0 && <Empty>Nothing came out of this yet.</Empty>}

        {proposed.length > 0 && (
          <>
            <h3>Needs a decision</h3>
            <ul className="cards decide">{proposed.map(decide)}</ul>
          </>
        )}

        {settled.length > 0 && (
          <details className="settled" open={proposed.length === 0}>
            <summary>{settled.length} settled</summary>
            <ul className="cards">
              {settled.map((item) => (
                <li key={item.id} className="muted">
                  <Status value={item.status} /> {item.text}
                  {item.taskId && <> <Link to={`/tasks/${item.taskId}`}>open the task</Link></>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <AddInline
          label="New action point"
          placeholder="Add an action point…"
          onAdd={(text) => act(() => api.post(`/meetings/${id}/actions`, { text }))}
        />
        {/* The project used to be settled down here, discovered only when acceptance was
            refused. It is a property of the meeting and now lives in the header with the
            rest of them; all that is left is saying so at the moment it blocks you. */}
        {!note.projectId && proposed.length > 0 && (
          <p className="muted">Link this note to a project — in the header — before a point can become a task.</p>
        )}
      </Panel>
    ),

    note: (
      <Panel key="note" title="Notes">
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
      </Panel>
    ),

    agenda: (
      <Fold
        key="agenda"
        title="Agenda"
        open={phase === 'scheduled' || phase === 'live'}
        aside={
          note.agenda.length > 0 ? (
            <Badge tone={covered === note.agenda.length ? 'ok' : 'neutral'}>
              {covered}/{note.agenda.length} covered
            </Badge>
          ) : undefined
        }
      >
        {note.agenda.length === 0 ? (
          <Empty>No agenda.</Empty>
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
                        api.post(`/meetings/${id}/agenda/${item.id}/covered`, { covered: e.target.checked }),
                      )
                    }
                  />{' '}
                  <span className={item.covered ? 'muted' : undefined}>{item.title}</span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(() => api.del(`/meetings/${id}/agenda/${item.id}`))}
                  aria-label={`Remove ${item.title}`}
                >
                  remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AddInline
          label="New agenda item"
          placeholder="Add an agenda item…"
          onAdd={(title) => act(() => api.post(`/meetings/${id}/agenda`, { title }))}
        />
      </Fold>
    ),

    /*
     * Who was there, and whether the bot may listen.
     *
     * Open whenever consent is incomplete, wherever the phase would otherwise have put it.
     * Recording is refused unless everyone has agreed, and this list is the only thing that
     * can fix that — it used to sit second from the bottom, below the panel that needed it.
     */
    people: (
      <Fold
        key="people"
        title="People"
        open={phase === 'scheduled' || consentMissing}
        aside={
          note.unconsentedPresent.length > 0 ? (
            <Badge tone="danger">{note.unconsentedPresent.length} not asked</Badge>
          ) : note.attendees.length > 0 ? (
            <Badge tone={note.everyoneConsented ? 'ok' : 'warning'}>
              {note.attendees.length} {note.everyoneConsented ? 'consented' : 'attendees'}
            </Badge>
          ) : undefined
        }
      >
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
          <Empty>Nobody recorded.</Empty>
        ) : (
          <ul className="cards">
            {note.attendees.map((person) => (
              <li key={person.id}>
                {person.name}
                {person.email && <span className="muted"> · {person.email}</span>}{' '}
                {person.detectedAt && (
                  <Badge tone="ok" title="Seen in the meeting by the bot">present</Badge>
                )}{' '}
                {person.consent === 'granted' && <Badge tone="ok">consented</Badge>}
                {person.consent === 'declined' && <Badge tone="danger">declined</Badge>}
                {!person.consent && <Badge tone="warning">not asked</Badge>}
                <div className="row">
                  <Button size="sm" onClick={() => void act(() => api.post(`/meetings/${id}/attendees/${person.id}/consent`, { consent: 'granted' }))}>
                    consented
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/meetings/${id}/attendees/${person.id}/consent`, { consent: 'declined' }))}>
                    declined
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => api.del(`/meetings/${id}/attendees/${person.id}`))}>
                    remove
                  </Button>
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
      </Fold>
    ),

    live: (
      <Fold
        key="live"
        title="Recording"
        open={phase === 'scheduled' || phase === 'live'}
        aside={note.transcribedAt ? <Badge tone="ok">transcribed</Badge> : undefined}
      >
        <LivePanel noteId={id} canRecord={note.everyoneConsented} onFinished={() => void load()} />
        {note.transcribedAt && (
          <p className="muted">
            Transcribed {note.transcribedAt.slice(0, 16).replace('T', ' ')}
            {note.transcriptCostCents != null &&
              (note.transcriptCostCents === 0
                ? ' · cost under € 0,01'
                : ` · cost ${euros.format(note.transcriptCostCents / 100)}`)}
          </p>
        )}
      </Fold>
    ),

    /* Below the notes, because the notes are the point and the transcript is the
       evidence. It used to be inside them, which had it exactly backwards. */
    evidence: (
      <Fold key="evidence" title="Transcript" open={false}>
        <Transcripts noteId={id} />
      </Fold>
    ),

    /*
     * Planning that writes to the board.
     *
     * Only on a planning note, and only until it has produced one — after that the panel is
     * a link, because the decision has been made and re-offering it invites a second sprint
     * nobody meant to create.
     */
    sprint:
      note.template === 'sprint_planning' && note.projectId && !note.sprintId ? (
        <PlanTheSprint key="sprint" noteId={id} projectId={note.projectId} onPlanned={load} />
      ) : note.sprintId && sprint ? (
        <Panel key="sprint" title="Sprint">
          <SprintLine sprint={sprint} />
        </Panel>
      ) : null,

    discussion: (
      <Fold key="discussion" title="Discussion" open={false}>
        <Comments entityId={id} />
      </Fold>
    ),

    timeline: (
      <Fold key="timeline" title="Timeline" open={false}>
        <Timeline entityId={id} />
      </Fold>
    ),
  };

  const room = `/meetings/${id}/room`;

  /*
   * Print the minutes, all of them.
   *
   * A fold is a screen affordance and paper has none, but no browser expands a closed
   * `<details>` for printing — it prints the summary and drops the contents, silently, which
   * is the worst of the available failures: a page that looks complete and is not. There is
   * no CSS for it either; a closed `<details>` hides its children through the UA's own
   * machinery rather than through anything a stylesheet can reach. So they are opened here
   * and put back when the dialog closes.
   */
  const printMinutes = () => {
    const closed = Array.from(
      document.querySelectorAll<HTMLDetailsElement>('details:not([open])'),
    );
    for (const d of closed) d.open = true;
    window.addEventListener(
      'afterprint',
      () => {
        for (const d of closed) d.open = false;
      },
      { once: true },
    );
    window.print();
  };

  /*
   * Finishing with points still undecided is allowed, but not silently.
   *
   * "Mark done" sat next to points nobody had settled and closed the meeting without
   * mentioning them; the proposals stayed proposed and never became anybody's problem. The
   * confirmation is not a block — writing a note up and settling it later is ordinary — it
   * just refuses to let it happen by accident.
   */
  const markDone = async () => {
    if (proposed.length > 0) {
      const go = await confirm({
        title: `Mark done with ${proposed.length} point${proposed.length === 1 ? '' : 's'} still undecided?`,
        body: 'They stay proposed and will not become tasks. You can settle them afterwards.',
        confirmLabel: 'Mark done anyway',
      });
      if (!go) return;
    }
    // `force` carries the answer to the question above. The server asks it too — the room, the
    // assistant and anything else that finalises should not be able to skip it just because
    // this page is where the dialog happens to live.
    await act(() => api.post(`/meetings/${id}/finalise`, { force: proposed.length > 0 }));
  };

  return (
    <>
      <PageHeader
        title={note.title}
        back={{ to: '/meetings', label: 'Meetings' }}
        /*
         * Facts, not verbs. Everything here is a property of the meeting, which is why the
         * project selector moved up into it: it was at the bottom of the action points,
         * where you found it only by being refused.
         */
        meta={
          <>
            <Status value={note.status} />
            <span>{note.meetingDate}</span>
            {note.template && <Badge>{note.template.replace(/_/g, ' ')}</Badge>}
            {ran != null && (
              <span title={timebox != null ? `Timeboxed at ${timebox}m` : undefined}>
                ran {humanMinutes(ran)}
                {over != null && <span className="over"> · {over}m over</span>}
              </span>
            )}
            {note.agenda.length > 0 && (
              <span>{covered}/{note.agenda.length} covered</span>
            )}
            {client && <Link to={`/clients/${client.id}`}>{client.name}</Link>}
            <label className="meta-pick">
              Project{' '}
              <select
                aria-label="Project"
                value={note.projectId ?? ''}
                onChange={(e) =>
                  void act(() => api.patch(`/meetings/${id}`, { projectId: e.target.value || null }))
                }
              >
                <option value="">Not linked</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {sprint && <Link to={`/board/sprints/${sprint.id}`}>{sprint.name}</Link>}
          </>
        }
        /* The primary one goes last, where the eye finishes — and which one is primary is the
           whole point of the phase: before, it is the way in; after, it is the way to finish. */
        actions={
          <>
            <Button
              variant="ghost"
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
              Delete
            </Button>
            {(phase === 'writeup' || phase === 'done') && (
              <Button onClick={printMinutes}>Print</Button>
            )}
            {phase === 'writeup' && <Link to={room} className="btn">Open the room</Link>}
            {phase === 'scheduled' && <Link to={room} className="btn btn-primary">Open the room</Link>}
            {phase === 'live' && <Link to={room} className="btn btn-primary">Rejoin the room</Link>}
            {phase === 'writeup' && (
              <Button variant="primary" onClick={() => void markDone()}>Mark done</Button>
            )}
          </>
        }
      />

      {/* A meeting that is running is the one thing on this page that cannot wait, and the
          page it belongs on is the other one. */}
      {phase === 'live' && (
        <p className="room-open" role="status">
          <span className="room-open-dot" aria-hidden="true" /> This meeting is running.{' '}
          <Link to={room}>Go back to the room</Link>
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {/* Two grid children, each its own stack. Placing the sections directly on the page
          grid would pack them into rows by DOM order instead, which makes the height of one
          panel decide where an unrelated one starts. */}
      <div className="page-main" data-span={8}>
        {ORDER[phase].main.map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      </div>
      <div className="page-rail" data-span={4}>
        {ORDER[phase].rail.map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      </div>
    </>
  );
}
