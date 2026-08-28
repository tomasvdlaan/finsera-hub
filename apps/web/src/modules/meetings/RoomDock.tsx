import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Behaviour } from '../../shell/LiveMeeting.js';
import type { FoundContext, LiveState, Proposal } from '../../shell/liveMeetingReducer.js';
import { useMeetingChat } from '../../shell/MeetingChat.js';
import { Composer, ConversationView } from '../../shell/conversation/index.js';
import { Empty } from '../../shell/ui/primitives.js';
import { LiveTab } from './LiveTab.js';
import { AgendaPanel, BoardPanel, PeoplePanel, type BoardColumn, type BoardTask } from './RoomPanels.js';
import { RichEditor } from './RichEditor.js';
import type { NoteCommand } from './noteCommands.js';
import type { Stage } from './RoomStrip.js';
import type { NoteDetail } from './types.js';

/**
 * `board` is the SCRUM board. The whiteboard is NOT here: it takes the stage instead, because
 * it is a thing you make rather than a thing you glance at, and a canvas in a drawer is a
 * canvas nobody draws on. `note` is its counterweight — it appears only while the whiteboard
 * has the stage, so the note is never more than one click away.
 */
export type DockTab =
  | 'agent'
  | 'transcript'
  | 'agenda'
  | 'board'
  | 'note'
  | 'people'
  | 'recording';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const stripTags = (snippet: string) => snippet.replace(/<\/?b>/g, '');

/** The wording for a proposal's kind, said as a heading rather than a slug. */
const KIND: Record<Proposal['kind'], string> = {
  action: 'Action point',
  agenda_covered: 'Agenda',
  decision: 'Decision',
  note: 'Worth noting',
};

/**
 * Everything that is not the note, along the bottom.
 *
 * The rail this replaces stood beside the notes and was five tabs deep, so at any moment four
 * of the five things a meeting needs were invisible and the notes had two thirds of a screen
 * to be written in. The split here is by how often you need a thing rather than by what kind
 * of thing it is: what you glance at constantly is in the strip above and never opens, what
 * you read occasionally is in here and opens when asked.
 *
 * Closed, it is a heartbeat — that something is being heard, by what, who is speaking, what it
 * has cost, and how much is waiting. That is the whole of what a recording indicator owes you
 * while you are listening to a person.
 *
 * It is the one dark surface in a light application, which is a deliberate and expensive
 * choice: it is the only thing on the screen that is happening on its own, and darkness is
 * how it says so without moving. In dark mode the trick inverts — see the stylesheet.
 */
export function RoomDock({
  note,
  stage,
  commands,
  live,
  running,
  open,
  tab,
  behaviours,
  enabled,
  maySpeak,
  columns,
  tasks,
  waiting,
  onOpen,
  onClose,
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
  /** What the stage is showing; the note tab exists only when it is not the note. */
  stage: Stage;
  /** Slash-menu commands, so the note is as editable here as it is on stage. */
  commands: NoteCommand[];
  live: LiveState;
  running: boolean;
  open: boolean;
  tab: DockTab;
  behaviours: Behaviour[];
  enabled: string[];
  maySpeak: boolean;
  columns: BoardColumn[];
  tasks: BoardTask[];
  waiting: number;
  onOpen: (tab: DockTab) => void;
  onClose: () => void;
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
  const last = live.lines[live.lines.length - 1];

  const tabs: Array<{ key: DockTab; label: string; count?: number }> = [
    { key: 'agent', label: 'Assistant', count: waiting || undefined },
    { key: 'transcript', label: 'Transcript', count: live.lines.length || undefined },
    { key: 'agenda', label: 'Agenda', count: note.agenda.filter((a) => !a.covered).length || undefined },
    { key: 'board', label: 'Board', count: tasks.length || undefined },
    /*
     * The note, only while something else has the stage.
     *
     * Listed second-to-last rather than first because it is a fallback, not a destination: when
     * the note IS the stage this tab would be the same thing twice.
     */
    ...(stage === 'board' ? [{ key: 'note' as const, label: 'Note' }] : []),
    { key: 'people', label: 'People', count: note.attendees.length || undefined },
    { key: 'recording', label: running ? 'Recording' : 'Start recording' },
  ];

  return (
    <aside className={open ? 'room-dock room-dock-open' : 'room-dock'}>
      {open ? (
        <>
          <div className="room-dock-head">
            <div className="room-dock-tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? 'room-dock-tab room-dock-tab-on' : 'room-dock-tab'}
                  onClick={() => onOpen(t.key)}
                >
                  {t.label}
                  {t.count !== undefined && <span className="room-dock-count"> {t.count}</span>}
                </button>
              ))}
            </div>

            <div className="room-dock-head-side">
              <Recording live={live} running={running} note={note} compact />
              {running && <span className="room-dock-cost">{money(live.costCents)}</span>}
              <button type="button" className="room-dock-toggle" onClick={onClose} title="Close">
                <Chevron down />
              </button>
            </div>
          </div>

          <div className="room-dock-body">
            {tab === 'agent' && (
              <Agent
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
            {tab === 'transcript' && <TranscriptPanel live={live} running={running} />}
            {tab === 'agenda' && (
              <div className="room-dock-panel">
                <AgendaPanel note={note} onCovered={onCovered} />
              </div>
            )}
            {tab === 'board' && (
              <div className="room-dock-panel room-dock-columns">
                <BoardPanel note={note} columns={columns} tasks={tasks} />
              </div>
            )}
            {tab === 'note' && (
              <div className="room-dock-panel room-dock-note">
                {/*
                  * The real editor, not a rendering of it.
                  *
                  * A read-only copy would be a second thing to keep in step, and would go stale
                  * the moment the assistant wrote a line. This is the same collaborative
                  * document, so a note jotted here while the board is up is a note in the note.
                  */}
                <RichEditor noteId={note.id} commands={commands} />
              </div>
            )}
            {tab === 'people' && (
              <div className="room-dock-panel">
                <PeoplePanel note={note} />
              </div>
            )}
            {tab === 'recording' && (
              <div className="room-dock-panel">
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
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="room-dock-rest">
          <Recording live={live} running={running} note={note} />

          <span className="room-dock-divider" aria-hidden="true" />

          {/*
            The last thing anybody said, and nothing before it.

            A scrolling transcript at the edge of a room pulls the eye every few seconds and
            competes with the person talking. One line, going nowhere, says the microphone is
            open — which is all this needs to say.
          */}
          <p className="room-dock-heard">
            {running ? (
              last ? (
                <>
                  {last.speaker && <span className="room-dock-speaker">{last.speaker}</span>}
                  <span className="room-dock-line">{last.text}</span>
                </>
              ) : (
                <span className="room-dock-line">Listening…</span>
              )
            ) : (
              <span className="room-dock-line">
                Nothing is being heard. Nothing is written down and nothing is charged.
              </span>
            )}
          </p>

          <div className="room-dock-rest-side">
            {waiting > 0 && (
              <button
                type="button"
                className="room-dock-waiting"
                onClick={() => onOpen('agent')}
              >
                {waiting} waiting
              </button>
            )}
            {running ? (
              <span className="room-dock-cost">{money(live.costCents)}</span>
            ) : (
              <button
                type="button"
                className="room-dock-start"
                onClick={() => onOpen('recording')}
              >
                Start recording
              </button>
            )}
            <button
              type="button"
              className="room-dock-toggle"
              onClick={() => onOpen('agent')}
              title="Open"
            >
              <Chevron />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** A chevron, drawn rather than typed — a glyph in a button is a font's opinion of an icon. */
function Chevron({ down }: { down?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={down ? 'M6 9l6 6 6-6' : 'M18 15l-6-6-6 6'} />
    </svg>
  );
}

/**
 * Whether anything is actually being heard, and by what.
 *
 * A bot is a process somewhere else that has to travel to a call and be admitted, so "sent"
 * and "in the call" are different states and the gap between them is the one you stare at
 * wondering whether it worked. Consent sits on the same line because it is the reason
 * recording refuses to start, and burying that under a tab is how you find out at the button.
 */
function Recording({
  live,
  running,
  note,
  compact,
}: {
  live: LiveState;
  running: boolean;
  note: NoteDetail;
  compact?: boolean;
}) {
  const unasked = note.attendees.filter((p) => p.consent !== 'granted').length;

  const what = !running
    ? live.connecting
      ? 'Sending the bot…'
      : 'Not recording'
    : live.needsAudio
      ? 'No audio reaching the meeting'
      : live.source === 'bot'
        ? live.joinedAt
          ? 'Recording — the bot is in the call'
          : 'The bot has been sent, and is not in yet'
        : live.source === 'tab'
          ? 'Recording — a shared tab'
          : 'Recording — this microphone';

  const state = !running ? 'off' : live.needsAudio ? 'warn' : live.joinedAt || live.source !== 'bot' ? 'on' : 'wait';

  return (
    <div className={compact ? 'room-recording room-recording-compact' : 'room-recording'}>
      <span className={`room-pulse room-pulse-${state}`} aria-hidden="true" />
      <span className="room-wave" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={running && !live.needsAudio ? 'room-wave-on' : undefined} />
        ))}
      </span>
      <span className="room-recording-what">
        <strong>{what}</strong>
        {!compact && (
          <span className="room-recording-consent">
            {note.attendees.length === 0
              ? 'nobody added yet'
              : unasked > 0
                ? `${unasked} not asked to be recorded`
                : `all ${note.attendees.length} consented`}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * What the assistant has done, and what it wants a decision on.
 *
 * Ordered by when this browser learned of each thing rather than by kind, because during a
 * meeting the useful question is "what just happened" and a list sorted into categories
 * answers "what kinds of thing exist". Arrival is stamped here rather than read off the
 * message: proposals carry no time, so the honest clock is the one on the receiving end.
 *
 * The summary is not in the stream. It is rewritten wholesale every pass — a statement of
 * where the meeting is now, not an event — so it stays pinned at the top where a statement of
 * the present belongs.
 */
function Agent({
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
  const [settings, setSettings] = useState(false);
  const proposed = note.actionItems.filter((a) => a.status === 'proposed');
  const byId = new Map(note.agenda.map((a) => [a.id, a]));

  const liveOnly = live.proposals.filter(
    (p) => p.status === 'open' && (p.kind !== 'action' || !proposed.some((a) => a.text === p.text)),
  );

  const seen = useArrivals([...proposed.map((a) => a.id), ...liveOnly.map((p) => p.id)]);
  const order = (id: string) => seen[id] ?? 0;

  const entries = [
    ...proposed.map((item) => ({ id: item.id, at: order(item.id), node: (
      <li key={item.id} className="room-entry" data-kind="action">
        <span className="room-entry-at">{stamp(seen[item.id])}</span>
        <div className="room-entry-body">
          <span className="room-entry-kind">
            Action point{item.source === 'ai' ? ' · heard' : ''}
          </span>
          <p className="room-entry-text">{item.text}</p>
          {/*
            Where it will land, when that is not obvious.

            This used to be the reason the button was dead: no project, no board, no card.
            A meeting with no project still produces work, so it goes to the internal
            project instead — and the one thing that must not happen is a card appearing
            somewhere the person who pressed the button did not expect.
          */}
          {!note.projectId && (
            <p className="faint">
              This note has no project, so it goes on{' '}
              <Link to={`/meetings/${note.id}`}>Internal</Link>.
            </p>
          )}
          <div className="room-entry-buttons">
            <button
              type="button"
              className="act"
              disabled={busyId === item.id}
              onClick={() => onDismiss(item.id)}
            >
              Not that
            </button>
            <button
              type="button"
              className="act"
              data-variant="primary"
              disabled={busyId === item.id}
              title={
                note.projectId
                  ? 'Put this on the board as a task'
                  : 'Put this on the internal board — this meeting has no project'
              }
              onClick={() => onAccept(item.id)}
            >
              Make it a card
            </button>
          </div>
        </div>
      </li>
    ) })),
    ...liveOnly.map((p) => {
      const item = p.agendaItemId ? byId.get(p.agendaItemId) : undefined;
      const found = live.context[p.id] ?? [];
      return { id: p.id, at: order(p.id), node: (
        <li key={p.id} className="room-entry" data-kind={p.kind}>
          <span className="room-entry-at">{stamp(seen[p.id])}</span>
          <div className="room-entry-body">
            <span className="room-entry-kind">{KIND[p.kind]}</span>
            <p className="room-entry-text">{p.text}</p>

            {/*
              A document it went and found, unasked, about this very thing — next to the
              thing rather than in a shelf of its own, because it is the evidence for the
              decision the buttons are asking for.
            */}
            {found.length > 0 && (
              <div className="room-entry-found">
                <span className="faint">On file about this</span>
                {found.map((hit: FoundContext) => (
                  <div key={hit.entityId}>
                    <Link to={`/docs/${hit.entityId}`} target="_blank">
                      {hit.title}
                    </Link>
                    {hit.snippet && <div className="faint">{stripTags(hit.snippet)}</div>}
                  </div>
                ))}
              </div>
            )}

            {item && !item.covered && (
              <div className="room-entry-buttons">
                <button type="button" className="act" onClick={() => onCovered(item.id, true)}>
                  Mark covered
                </button>
              </div>
            )}
          </div>
        </li>
      ) };
    }),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="room-dock-split">
      <div className="room-dock-stream">
        {running && live.extraction?.summary && (
          <section className="room-where">
            <span className="room-strip-label">Where we are</span>
            <p>{live.extraction.summary}</p>
          </section>
        )}

        {running && (live.extraction?.decisions.length ?? 0) > 0 && (
          <section className="room-where">
            <span className="room-strip-label">Decisions heard</span>
            <ul className="cards">
              {live.extraction!.decisions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="faint">
              Written into the note when the meeting ends. Correct them there if it misheard.
            </p>
          </section>
        )}

        {running && (live.extraction?.openQuestions.length ?? 0) > 0 && (
          <section className="room-where">
            <span className="room-strip-label">Left open</span>
            <ul className="cards">
              {live.extraction!.openQuestions.map((q) => (
                <li key={q} className="muted">
                  {q}
                </li>
              ))}
            </ul>
          </section>
        )}

        {entries.length > 0 ? (
          <ul className="room-entries">{entries.map((e) => e.node)}</ul>
        ) : (
          <Empty>
            {running
              ? 'Nothing yet. It writes into the note as it goes, and asks here when something needs a decision.'
              : 'Nothing recorded. Start recording and it will take notes, watch the agenda and look things up.'}
          </Empty>
        )}

        {behaviours.length > 0 && (
          <section className="room-behaviours">
            <button
              type="button"
              className="link-button"
              onClick={() => setSettings((s) => !s)}
            >
              {settings ? 'hide what it is doing' : 'what it is doing'}
            </button>
            {settings && (
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
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={maySpeak}
                      onChange={(e) => onConfigure({ maySpeak: e.target.checked })}
                    />{' '}
                    may speak aloud
                  </label>
                </li>
              </ul>
            )}
          </section>
        )}
      </div>

      <AskBox noteId={note.id} />
    </div>
  );
}

/**
 * When this browser first saw each thing, kept across renders.
 *
 * Not a timestamp from the server — there isn't one. A proposal arrives with an id, a kind
 * and a sentence, so the only honest time available is the moment it appeared here, which is
 * within a second or two of when it was said.
 */
function useArrivals(ids: string[]) {
  const seen = useRef<Record<string, number>>({});
  const [, bump] = useState(0);

  useEffect(() => {
    let fresh = false;
    for (const id of ids) {
      if (seen.current[id] === undefined) {
        seen.current[id] = Date.now();
        fresh = true;
      }
    }
    if (fresh) bump((n) => n + 1);
    // Keyed on the set of ids, not the array, which is a new one every render.
  }, [ids.join(' ')]);

  return seen.current;
}

const stamp = (at?: number) =>
  at === undefined
    ? ''
    : new Date(at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

/** Everything that has been said, when you actually want to read it. */
function TranscriptPanel({ live, running }: { live: LiveState; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [live.lines.length]);

  if (live.lines.length === 0) {
    return (
      <div className="room-dock-panel">
        <Empty>{running ? 'Nothing heard yet.' : 'Nothing was recorded in this session.'}</Empty>
      </div>
    );
  }

  return (
    <div className="room-dock-panel room-transcript">
      {live.lines.map((line) => (
        <p key={line.id} className="room-transcript-line">
          <span className="room-entry-at">{clock(line.at)}</span>
          {line.speaker && <strong>{line.speaker}</strong>}
          <span>{line.text}</span>
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}

/**
 * Ask about this meeting.
 *
 * The thread lives above the router in MeetingChatProvider — this panel unmounts every time
 * the dock changes tab or closes, and used to take the answer with it.
 */
function AskBox({ noteId }: { noteId: string }) {
  const { noteId: threadFor, turns, busy, waited, ask } = useMeetingChat();
  const mine = threadFor === noteId ? turns : [];

  return (
    <section className="room-ask">
      <span className="room-strip-label">Ask about this meeting</span>
      <ConversationView turns={mine} busy={busy} waited={waited} compact />
      <Composer
        onSend={(q) => void ask(noteId, q)}
        busy={busy}
        placeholder={mine.length > 0 ? 'Ask a follow-up…' : 'What did we agree last time?'}
      />
    </section>
  );
}
