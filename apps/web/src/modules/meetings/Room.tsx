import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useLiveMeeting } from '../../shell/LiveMeeting.js';
import { useMeetingChat } from '../../shell/MeetingChat.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { noteActions } from './actions.js';
import { RichEditor } from './RichEditor.js';
import { RoomBar } from './RoomBar.js';
import { RoomDock, type DockTab } from './RoomDock.js';
import type { BoardColumn, BoardTask } from './RoomPanels.js';
import { RoomStrip } from './RoomStrip.js';
import { Suggestions } from './Suggestions.js';
import type { Sprint } from '../scrum/types.js';
import { calloutNode, taskNode, type NoteCommand } from './noteCommands.js';
import type { NoteDetail } from './types.js';

interface Template {
  name: string;
  label: string;
  timeboxMinutes: number;
}

/**
 * The room you run a meeting from.
 *
 * One screen. The note is a sheet on a ground and has the stage to itself, because the note
 * is the thing the meeting is making. A band under the title carries the three facts you
 * glance at without looking away from the conversation — where the agenda is, what the board
 * says, how much is waiting on you — and everything else is in a dock along the bottom that
 * is a heartbeat when closed and a panel when opened.
 *
 * This replaces a rail of five tabs beside the notes, where four fifths of what a meeting
 * needs was invisible at any moment and the notes had two thirds of a screen to be written
 * in. The split now is by how often you look at a thing, not by what kind of thing it is.
 *
 * The note page is still where you read and correct a note afterwards. This is for while it
 * is happening, which is why it takes the viewport and drops the rail.
 *
 * It does not own the recording. That lives above the router, so walking out of the room does
 * not end the meeting — which it used to, and see LiveMeeting.tsx for what that cost.
 */
export function Room() {
  const { ask } = useDialog();
  const { wroteAt } = useMeetingChat();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const {
    live,
    behaviours,
    enabled,
    maySpeak,
    resume,
    startBot,
    startCapture,
    resumeAudio,
    stop,
    configure,
  } = useLiveMeeting();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [projectName, setProjectName] = useState<string>();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dock, setDock] = useState<DockTab | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);


  useDocumentTitle(note ? `${note.title} — room` : 'Meeting room');

  const load = useCallback(async () => {
    try {
      const fresh = await api.get<NoteDetail>(`/meetings/${id}`);
      setNote(fresh);
      // The body is deliberately not read from here — the editor holds the document over its
      // own connection, so reloading the note for its proposals cannot disturb the text.
      return fresh;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
    void resume(id);
    api
      .get<Template[]>('/meetings/templates')
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [id, load, resume]);

  /** The board, for the project this meeting is about. */
  useEffect(() => {
    const projectId = note?.projectId;
    if (!projectId) {
      setColumns([]);
      setTasks([]);
      setProjectName(undefined);
      setSprint(null);
      return;
    }
    void Promise.allSettled([
      api.get<{ columns: BoardColumn[] }>(`/scrum/boards/${projectId}`),
      api.get<BoardTask[]>(`/scrum/tasks?projectId=${projectId}`),
      api.get<{ name: string }>(`/crm/projects/${projectId}`),
      // Null for a project that runs a flow board, which is most of them.
      api.get<Sprint | null>(`/scrum/projects/${projectId}/sprint`),
    ]).then(([board, open, project, running]) => {
      if (board.status === 'fulfilled') setColumns(board.value.columns);
      if (open.status === 'fulfilled') setTasks(open.value);
      if (project.status === 'fulfilled') setProjectName(project.value.name);
      setSprint(running.status === 'fulfilled' ? running.value : null);
    });
  }, [note?.projectId]);

  /** Something happened that makes the note stale — somebody joined, or it ended. */
  useEffect(() => {
    if (live.noteStaleAt === 0) return;
    void load();
  }, [live.noteStaleAt, load]);

  /*
   * The assistant wrote into the note.
   *
   * Only the surrounding data is reloaded — action points, agenda, attendees. The text itself
   * needs nothing: the assistant's write went through the same document authority the editor
   * is connected to, so the paragraph is already on screen before this runs.
   *
   * This used to flush the editor and refetch the body, because the assistant's write and the
   * editor's autosave were two clients overwriting one string and whoever went last won.
   */
  useEffect(() => {
    if (wroteAt === 0) return;
    void load();
  }, [wroteAt, load]);

  const running = live.running && live.noteId === id;

  /**
   * What the toolbar offers beyond formatting, in a meeting.
   *
   * Each one does something real and then writes a line about it, which is the point: saying
   * "Mike is blocked on the compliance sign-off" out loud in a stand-up should put a blocker on
   * the card, not only in a paragraph nobody re-reads.
   *
   * Memoised on what they close over rather than recreated every render, so the toolbar is
   * not rebuilt on every keystroke.
   */
  const commands = useMemo<NoteCommand[]>(
    () => [
      {
        name: 'ticket',
        label: 'Ticket',
        hint: 'an action point, decided later',
        run: async () => {
          const answer = await ask({
            title: 'What needs doing?',
            confirmLabel: 'Add it',
            fields: [{ name: 'text', label: 'Action', required: true }],
          });
          if (!answer?.text) return null;
          // Proposed, never a task. Accepting one stays a decision made in the rail — the
          // same rule whether it was typed or a model suggested it.
          await noteActions.add(id, answer.text);
          await load();
          return taskNode(answer.text);
        },
      },
      {
        name: 'blocker',
        label: 'Blocker',
        hint: 'and block the card it is about',
        run: async () => {
          const open = tasks.filter((t) => !t.blockedReason);
          const answer = await ask({
            title: 'What is in the way?',
            confirmLabel: 'Record it',
            fields: [
              {
                name: 'reason',
                label: 'Blocked on',
                required: true,
                placeholder: 'Compliance sign-off on the retention policy',
              },
              {
                name: 'taskId',
                label: 'Which card',
                type: 'select',
                hint: 'Optional. Choosing one marks it blocked on the board too.',
                options: [
                  { value: '', label: 'Just note it' },
                  ...open.map((t) => ({ value: t.id, label: t.title })),
                ],
              },
            ],
          });
          if (!answer?.reason) return null;
          if (answer.taskId) {
            await api
              .post(`/scrum/tasks/${answer.taskId}/block`, { reason: answer.reason })
              .catch((e: Error) => setError(e.message));
          }
          return calloutNode('Blocker', answer.reason);
        },
      },
      {
        name: 'decision',
        label: 'Decision',
        hint: 'something the meeting settled',
        run: async () => {
          const answer = await ask({
            title: 'What was decided?',
            confirmLabel: 'Write it down',
            fields: [{ name: 'text', label: 'Decision', required: true }],
          });
          return answer?.text ? calloutNode('Decision', answer.text) : null;
        },
      },
    ],
    [ask, id, load, tasks],
  );

  const act = async (itemId: string, fn: () => Promise<unknown>) => {
    setBusyId(itemId);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * End the meeting and go and look at what it produced.
   *
   * Sequenced rather than concurrent: stop, then let the note reload, then leave. Navigating
   * while the socket closes and the note is being rewritten is how you land on a page showing
   * a version of the meeting that existed for half a second.
   */
  const end = async () => {
    setEnding(true);
    try {
      if (running) await stop();
      else await noteActions.finalise(id).catch(() => undefined);
      await load();
      navigate(`/meetings/${id}`);
    } finally {
      setEnding(false);
    }
  };

  if (!note) {
    return (
      <div className="room room-empty">
        {error ? <p className="error">{error}</p> : <p className="muted">Opening the room…</p>}
      </div>
    );
  }

  const timebox = templates.find((t) => t.name === note.template)?.timeboxMinutes;

  /**
   * How much is sitting on somebody's decision.
   *
   * Both kinds, counted once: proposals the model has made this session, and the action points
   * already written down waiting to become cards. A live proposal that has already been
   * persisted as an action point is the same suggestion twice, and counting it twice makes
   * the one number in the strip a number nobody trusts.
   */
  const proposed = note.actionItems.filter((a) => a.status === 'proposed');
  const waiting =
    proposed.length +
    live.proposals.filter(
      (p) =>
        p.status === 'open' && (p.kind !== 'action' || !proposed.some((a) => a.text === p.text)),
    ).length;

  return (
    <div className="room">
      <RoomBar
        note={note}
        projectName={projectName}
        sprint={sprint}
        running={running}
        onEnd={() => void end()}
        ending={ending}
      />

      <RoomStrip
        note={note}
        columns={columns}
        tasks={tasks}
        running={running}
        startedAt={live.startedAt}
        timeboxMinutes={timebox}
        waiting={waiting}
        onOpen={(t) => setDock(t)}
      />

      {/*
        The note, on a ground, at a width you can read.

        Nothing is docked beside it. The thing you are making during the meeting should look
        like a document rather than one panel among five, and a measure that runs the width of
        a 27-inch screen is not a document.
      */}
      <main className="room-stage">
        <article className="room-sheet">
          {error && <p className="error">{error}</p>}
          {running && live.aiNotes && (
            <span className="tag room-writing" title="The assistant is writing into its own section">
              ✦ assistant writing
            </span>
          )}
          <RichEditor noteId={id} commands={commands} />
        </article>
      </main>

      {/*
        Suggestions rise in front of the dock, one at a time.

        Above it in the DOM and over it in the layout: a suggestion is about the last thirty
        seconds, and by the time it has been scrolled to it is about nothing. They are hidden
        while the dock is open, because the dock is showing the same thing with more around it
        and two copies of one question is how you answer it twice. See Suggestions.tsx.
      */}
      <Suggestions
        noteId={live.noteId}
        proposals={live.proposals}
        context={live.context}
        running={running}
        hidden={dock !== null}
        onOpenAll={() => setDock('agent')}
      />

      <RoomDock
        note={note}
        live={live}
        running={running}
        open={dock !== null}
        tab={dock ?? 'agent'}
        behaviours={behaviours}
        enabled={enabled}
        maySpeak={maySpeak}
        columns={columns}
        tasks={tasks}
        waiting={waiting}
        onOpen={(t) => setDock(t)}
        onClose={() => setDock(null)}
        onConfigure={configure}
        onAccept={(itemId) => void act(itemId, () => noteActions.accept(id, itemId))}
        onDismiss={(itemId) => void act(itemId, () => noteActions.dismiss(id, itemId))}
        onCovered={(itemId, covered) =>
          void act(itemId, () => noteActions.setCovered(id, itemId, covered))
        }
        onStartBot={(meetingUrl) => void startBot(id, meetingUrl)}
        onStartCapture={(source, deviceId) => void startCapture(id, source, deviceId)}
        onStop={() => void stop()}
        onResumeAudio={() =>
          void resumeAudio(id, live.source === 'tab' ? 'tab' : 'microphone')
        }
        busyId={busyId}
      />
    </div>
  );
}
