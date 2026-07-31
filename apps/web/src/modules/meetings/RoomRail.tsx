import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Behaviour } from '../../shell/LiveMeeting.js';
import type { LiveState } from '../../shell/liveMeetingReducer.js';
import { useMeetingChat } from '../../shell/MeetingChat.js';
import { Composer, ConversationView } from '../../shell/conversation/index.js';
import { LiveTab } from './LiveTab.js';
import { TranscriptTicker } from './TranscriptTicker.js';
import type { NoteDetail } from './types.js';
import { Empty } from '../../shell/ui/primitives.js';

type Tab = 'ai' | 'live' | 'board' | 'agenda' | 'people';

export interface BoardColumn {
  key: string;
  label: string;
  isDone: boolean;
}

export interface BoardTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

/**
 * A search snippet as text.
 *
 * Postgres wraps the matched words in `<b>`. Rendering that as HTML would mean anything in a
 * document's extracted text executes when it appears in this rail, which is a high price for a
 * bold word — and these documents are uploaded files, so the text is even less ours than a
 * note body is.
 */
const stripTags = (snippet: string) => snippet.replace(/<\/?b>/g, '');

/**
 * The rail beside the notes.
 *
 * Four things a meeting needs at hand and none of which should be on top of the notes: what
 * the assistant is hearing, where the work stands, what is left on the agenda, and who is in
 * the room. Tabs rather than four stacked panels, because a rail that scrolls is a rail
 * nobody reads during a conversation.
 *
 * The AI tab is first and default. That is the point of the room.
 */
export function RoomRail({
  note,
  live,
  running,
  behaviours,
  enabled,
  maySpeak,
  columns,
  tasks,
  onConfigure,
  onAccept,
  onDismiss,
  onCovered,
  onStartBot,
  onStartCapture,
  onStop,
  onResumeAudio,
  busyId,
}: {
  note: NoteDetail;
  live: LiveState;
  running: boolean;
  behaviours: Behaviour[];
  enabled: string[];
  maySpeak: boolean;
  columns: BoardColumn[];
  tasks: BoardTask[];
  onConfigure: (next: { enabled?: string[]; maySpeak?: boolean }) => void;
  onAccept: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onCovered: (itemId: string, covered: boolean) => void;
  onStartBot: (meetingUrl: string) => void;
  onStartCapture: (source: 'microphone' | 'tab', deviceId?: string) => void;
  onStop: () => void;
  onResumeAudio: () => void;
  busyId: string | null;
}) {
  /*
   * Which tab you land on.
   *
   * Live when something is being recorded, because that is what you came back to check — and
   * the complaint that prompted this was not being able to find the bot after switching pages.
   * Assistant otherwise, which is what the room is for the rest of the time.
   */
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab = chosen ?? (running ? 'live' : 'ai');
  const setTab = setChosen;
  const openAgenda = note.agenda.filter((a) => !a.covered);

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'ai', label: 'Assistant' },
    { key: 'live', label: 'Live' },
    { key: 'board', label: 'Board', count: tasks.length || undefined },
    { key: 'agenda', label: 'Agenda', count: openAgenda.length || undefined },
    { key: 'people', label: 'People', count: note.attendees.length || undefined },
  ];

  return (
    <aside className="room-rail">
      <div className="room-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'room-tab room-tab-on' : 'room-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count !== undefined && <span className="muted"> {t.count}</span>}
          </button>
        ))}
      </div>

      <div className="room-rail-body">
        {tab === 'ai' && (
          <AiTab
            note={note}
            live={live}
            running={running}
            behaviours={behaviours}
            enabled={enabled}
            maySpeak={maySpeak}
            onConfigure={onConfigure}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onCovered={onCovered}
            busyId={busyId}
          />
        )}
        {tab === 'live' && (
          <LiveTab
            noteId={note.id}
            live={live}
            running={running}
            canRecord={note.everyoneConsented}
            onStartBot={onStartBot}
            onStartCapture={onStartCapture}
            onStop={onStop}
            onResumeAudio={onResumeAudio}
          />
        )}
        {tab === 'board' && <BoardTab note={note} columns={columns} tasks={tasks} />}
        {tab === 'agenda' && <AgendaTab note={note} onCovered={onCovered} />}
        {tab === 'people' && <PeopleTab note={note} />}
      </div>

      {running && <TranscriptTicker lines={live.lines} />}
    </aside>
  );
}

/**
 * What the assistant is doing, and what it wants a decision on.
 *
 * The summary, the decisions and the open questions all arrive over the socket on every
 * extraction pass and, before this, were rendered nowhere in the application — the model
 * found the decisions in a meeting and told the browser about them roughly every ninety
 * seconds, and the browser dropped them on the floor.
 */
function AiTab({
  note,
  live,
  running,
  behaviours,
  enabled,
  maySpeak,
  onConfigure,
  onAccept,
  onDismiss,
  onCovered,
  busyId,
}: {
  note: NoteDetail;
  live: LiveState;
  running: boolean;
  behaviours: Behaviour[];
  enabled: string[];
  maySpeak: boolean;
  onConfigure: (next: { enabled?: string[]; maySpeak?: boolean }) => void;
  onAccept: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onCovered: (itemId: string, covered: boolean) => void;
  busyId: string | null;
}) {
  const proposed = note.actionItems.filter((a) => a.status === 'proposed');
  const uncoveredById = new Map(note.agenda.map((a) => [a.id, a]));

  /*
   * Proposals the model has made this session that are not yet rows.
   *
   * Live proposals become action points when the meeting stops, so during a meeting both
   * exist: the socket's, and any already written down. Showing both would double every
   * item, so the persisted rows win — they are the ones with an accept button that works.
   */
  const liveOnly = live.proposals.filter(
    (p) => p.kind !== 'action' || !proposed.some((a) => a.text === p.text),
  );

  return (
    <>
      {running && live.extraction?.summary && (
        <section className="room-block">
          <h3>Where we are</h3>
          <p>{live.extraction.summary}</p>
        </section>
      )}

      {running && (live.extraction?.decisions.length ?? 0) > 0 && (
        <section className="room-block">
          <h3>Decisions heard</h3>
          <ul className="cards">
            {live.extraction!.decisions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <p className="muted">
            Written into the note when the meeting ends. Correct them there if the assistant
            misheard.
          </p>
        </section>
      )}

      {running && (live.extraction?.openQuestions.length ?? 0) > 0 && (
        <section className="room-block">
          <h3>Left open</h3>
          <ul className="cards">
            {live.extraction!.openQuestions.map((q) => (
              <li key={q} className="muted">
                {q}
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposed.length > 0 && (
        <section className="room-block">
          <h3>Needs your decision</h3>
          {!note.projectId && (
            <p className="muted">
              Link a project on the note before these can become tasks.
            </p>
          )}
          <ul className="cards">
            {proposed.map((item) => (
              <li key={item.id} className="room-proposal">
                <div>
                  {item.source === 'ai' && <span className="tag">suggested</span>} {item.text}
                </div>
                <div className="row">
                  <button
                    className="link-button"
                    disabled={busyId === item.id || !note.projectId}
                    onClick={() => onAccept(item.id)}
                  >
                    make it a task
                  </button>
                  <button
                    className="link-button"
                    disabled={busyId === item.id}
                    onClick={() => onDismiss(item.id)}
                  >
                    dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {running && liveOnly.length > 0 && (
        <section className="room-block">
          <h3>Noticed</h3>
          <ul className="cards">
            {liveOnly.map((p) => {
              const item = p.agendaItemId ? uncoveredById.get(p.agendaItemId) : undefined;
              const found = live.context[p.id] ?? [];
              return (
                <li key={p.id}>
                  <span className="tag">{p.kind.replace('_', ' ')}</span> {p.text}

                  {/*
                    A document the assistant went and looked up, unasked.
                    
                    The one thing here that nobody had to think of. The chat assistant can
                    search documents and can be asked to mid-meeting; the point is that in a
                    meeting about audit logging, nobody thinks "I should check the retention
                    policy" until three days later.
                  */}
                  {found.length > 0 && (
                    <div className="room-found">
                      <span className="muted">On file about this</span>
                      {found.map((hit) => (
                        <div key={hit.entityId}>
                          <Link to={`/docs/${hit.entityId}`}>{hit.title}</Link>
                          {hit.snippet && <div className="muted">{stripTags(hit.snippet)}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Agenda coverage is the one proposal that can be acted on now, and until
                      the room there was nowhere to act on it — the model's belief was written
                      into the note as prose and could only be read, never applied. */}
                  {item && !item.covered && (
                    <div className="row">
                      <button className="link-button" onClick={() => onCovered(item.id, true)}>
                        mark covered
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted">Recorded on the note when the meeting ends.</p>
        </section>
      )}

      {running && behaviours.length > 0 && (
        <section className="room-block">
          <h3>What it is doing</h3>
          <ul className="agenda">
            {behaviours.map((b) => (
              <li key={b.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={enabled.includes(b.name)}
                    onChange={(e) =>
                      onConfigure({
                        enabled: e.target.checked
                          ? [...enabled, b.name]
                          : enabled.filter((n) => n !== b.name),
                      })
                    }
                  />{' '}
                  {b.name.replace(/_/g, ' ')}
                </label>
                {b.canSpeak && !maySpeak && <span className="badge">silent</span>}
              </li>
            ))}
          </ul>
          <label className="muted">
            <input
              type="checkbox"
              checked={maySpeak}
              onChange={(e) => onConfigure({ maySpeak: e.target.checked })}
            />{' '}
            may speak aloud
          </label>
        </section>
      )}

      <AskBox noteId={note.id} />
    </>
  );
}

/**
 * Ask about this meeting.
 *
 * The same assistant as the sidebar, with the note as its context, so "what did we quote them
 * last time" is answerable without leaving the room. The thread lives in MeetingChatProvider
 * above the router — this panel unmounts every time the rail changes tab, and used to take the
 * answer with it.
 *
 * One request, one answer, no streaming, so it says how long it has been waiting: several
 * silent seconds mid-meeting reads as broken.
 */
function AskBox({ noteId }: { noteId: string }) {
  const { noteId: threadFor, turns, busy, waited, ask } = useMeetingChat();

  // A thread from a different meeting is not this meeting's history.
  const mine = threadFor === noteId ? turns : [];

  return (
    <section className="room-block room-ask">
      <h3>Ask about this meeting</h3>
      {/*
        The same conversation view the command bar and the assistant page use — so an answer
        that cites an invoice shows the invoice here too, which it never did while this
        rendered its own turns.
      */}
      <ConversationView turns={mine} busy={busy} waited={waited} compact />
      <Composer
        onSend={(q) => void ask(noteId, q)}
        busy={busy}
        placeholder={mine.length > 0 ? 'Ask a follow-up…' : 'What did we agree last time?'}
      />
    </section>
  );
}

/** Where the work stands, on this note's project, using that project's own columns. */
function BoardTab({
  note,
  columns,
  tasks,
}: {
  note: NoteDetail;
  columns: BoardColumn[];
  tasks: BoardTask[];
}) {
  if (!note.projectId) {
    return (
      <p className="muted">
        This note is not linked to a project, so there is no board to show — and no action
        point can become a task. Link one on the note.
      </p>
    );
  }
  if (tasks.length === 0) {
    return <Empty>Nothing open on this project.</Empty>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const blocked = tasks.filter((t) => t.blockedReason);

  return (
    <>
      {/*
        Blocked cards first, out of their columns.

        In a stand-up the blockers are the agenda — the rest of the board is context. Leaving
        them scattered through the columns means reading the whole board to find the three
        things anybody needs to talk about.
      */}
      {blocked.length > 0 && (
        <section className="room-block">
          <h3>Blocked {blocked.length}</h3>
          <ul className="cards">
            {blocked.map((t) => (
              <li key={t.id}>
                <Link to={`/scrum/tasks/${t.id}`}>{t.title}</Link>
                <div className="task-blocked">
                  <span className="tag overdue">blocked</span> {t.blockedReason}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {columns
        .filter((c) => !c.isDone)
        .map((column) => {
          const inColumn = tasks.filter((t) => t.status === column.key);
          if (inColumn.length === 0) return null;
          const estimated = inColumn.reduce((n, t) => n + (t.estimateMinutes ?? 0), 0);
          return (
            <section className="room-block" key={column.key}>
              <h3>
                {column.label} <span className="muted">{inColumn.length}</span>
                {estimated > 0 && <span className="muted"> · {hours(estimated)}</span>}
              </h3>
              <ul className="cards">
                {inColumn.map((t) => (
                  <li key={t.id}>
                    <Link to={`/scrum/tasks/${t.id}`}>{t.title}</Link>
                    {t.priority !== 'normal' && (
                      <span className={`badge priority-${t.priority}`}> {t.priority}</span>
                    )}
                    {t.dueOn && (
                      <span className={t.dueOn < today ? 'tag overdue' : 'tag'}>
                        {' '}
                        {t.dueOn < today ? 'overdue' : 'due'} {t.dueOn}
                      </span>
                    )}
                    {t.blockedReason && (
                      <>
                        {' '}
                        <span className="tag overdue">blocked</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </>
  );
}

function AgendaTab({
  note,
  onCovered,
}: {
  note: NoteDetail;
  onCovered: (itemId: string, covered: boolean) => void;
}) {
  if (note.agenda.length === 0) {
    return <Empty>No agenda. Add one on the note if this meeting needs a shape.</Empty>;
  }
  return (
    <ul className="agenda">
      {note.agenda.map((item) => (
        <li key={item.id}>
          <label>
            <input
              type="checkbox"
              checked={item.covered}
              onChange={(e) => onCovered(item.id, e.target.checked)}
            />{' '}
            <span className={item.covered ? 'muted' : undefined}>{item.title}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who is here, and whether they agreed to be recorded.
 *
 * Consent is the one thing in this rail that is not a convenience. Recording refuses to start
 * without it, so a room that cannot record needs to say why here rather than failing at the
 * button.
 */
function PeopleTab({ note }: { note: NoteDetail }) {
  return (
    <>
      <ul className="cards">
        {note.attendees.map((person) => (
          <li key={person.id}>
            {person.name}{' '}
            {person.consent === 'granted' ? (
              <span className="tag">consented</span>
            ) : person.consent === 'declined' ? (
              <span className="tag overdue">declined</span>
            ) : (
              <span className="tag overdue">not asked</span>
            )}
            {person.detectedAt && <span className="muted"> · was in the call</span>}
          </li>
        ))}
      </ul>
      {note.attendees.length === 0 && (
        <Empty>Nobody recorded yet. Add attendees on the note.</Empty>
      )}
      {note.unconsentedPresent.length > 0 && (
        <p className="error">
          {note.unconsentedPresent.map((p) => p.name).join(', ')} joined the call without having
          agreed to be recorded.
        </p>
      )}
    </>
  );
}
