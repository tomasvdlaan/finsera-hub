import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useLiveMeeting } from '../../shell/LiveMeeting.js';
import { useDialog } from '../../shell/ui/Dialog.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { noteActions } from './actions.js';
import { RichEditor } from './RichEditor.js';
import { RoomBar } from './RoomBar.js';
import { RoomRail, type BoardColumn, type BoardTask } from './RoomRail.js';
import type { Sprint } from '../scrum/types.js';
import { calloutNode, taskNode, type SlashCommand } from './slashCommands.js';
import type { NoteDetail } from './types.js';
import { useNoteBody } from './useNoteBody.js';

interface Template {
  name: string;
  label: string;
  timeboxMinutes: number;
}

/**
 * The room you run a meeting from.
 *
 * One screen, three regions: what this meeting is along the top, the notes taking the whole
 * middle, and everything you need at hand down the right. It exists because the note page —
 * agenda, then live, then notes, then transcripts, then actions, then attendees, then
 * discussion, then timeline, twelve equal bands down a page — makes nothing prominent, and
 * during a meeting you need the notes, the work and what the assistant just heard visible at
 * the same time. That is the only thing a meeting screen is for.
 *
 * The note page is still where you read and correct a note afterwards. This is for while it
 * is happening, which is why it takes the viewport and drops the rail.
 *
 * It does not own the recording. That lives above the router, so walking out of the room does
 * not end the meeting — which it used to, and see LiveMeeting.tsx for what that cost.
 */
export function Room() {
  const { ask } = useDialog();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { live, behaviours, enabled, maySpeak, resume, stop, configure } = useLiveMeeting();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [projectName, setProjectName] = useState<string>();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { body, dirty, onChange, adopt, flush } = useNoteBody(id);

  useDocumentTitle(note ? `${note.title} — room` : 'Meeting room');

  const load = useCallback(async () => {
    try {
      const fresh = await api.get<NoteDetail>(`/meetings/${id}`);
      setNote(fresh);
      // Refuses while there are unsaved keystrokes — see useNoteBody.
      adopt(fresh.body);
      return fresh;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [id, adopt]);

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

  const running = live.running && live.noteId === id;

  /**
   * What `/` offers, in a meeting.
   *
   * Each one does something real and then writes a line about it, which is the point: saying
   * "Mike is blocked on the compliance sign-off" out loud in a stand-up should put a blocker on
   * the card, not only in a paragraph nobody re-reads.
   *
   * Memoised on what they close over rather than recreated every render, because the editor
   * reads them through a ref and a new array on every keystroke is churn for nothing.
   */
  const slashCommands = useMemo<SlashCommand[]>(
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
      // Anything that reloads the note has to be preceded by a write, or the reload adopts a
      // body older than what is on screen.
      await flush();
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
      await flush();
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
   * A true sentence about the work.
   *
   * Where the reference designs say "Sprint 42 · day 4 of 10", this platform has no sprint —
   * the table exists and nothing has ever written to it. Rather than invent a cadence, say
   * what the board actually knows.
   */
  const today = new Date().toISOString().slice(0, 10);
  const doneKeys = new Set(columns.filter((c) => c.isDone).map((c) => c.key));
  const open = tasks.filter((t) => !doneKeys.has(t.status));
  const overdue = open.filter((t) => t.dueOn && t.dueOn < today).length;
  const workLine = note.projectId
    ? [
        `${open.length} open`,
        overdue > 0 ? `${overdue} overdue` : null,
        open.some((t) => t.status === 'waiting_on_client')
          ? `${open.filter((t) => t.status === 'waiting_on_client').length} waiting on the client`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <div className="room">
      <RoomBar
        note={note}
        projectName={projectName}
        sprint={sprint}
        running={running}
        needsAudio={live.needsAudio}
        startedAt={live.startedAt}
        costCents={live.costCents}
        timeboxMinutes={timebox}
        workLine={workLine}
        onEnd={() => void end()}
        ending={ending}
      />

      <main className="room-notes">
        <div className="room-notes-head">
          <span className="muted">Notes</span>
          <span className="muted">
            <code>/ticket</code> <code>/blocker</code> <code>/decision</code>
          </span>
          {dirty && <span className="muted">saving…</span>}
          {running && live.aiNotes && (
            <span className="tag" title="The assistant is writing into its own section">
              ✦ assistant writing
            </span>
          )}
          {error && <span className="error">{error}</span>}
        </div>
        {/* The whole middle. Nothing above it but the bar, which is the requirement:
            the notes are the meeting, everything else is context. */}
        <RichEditor markdown={body} onChange={onChange} slashCommands={slashCommands} />
      </main>

      <RoomRail
        note={note}
        live={live}
        running={running}
        behaviours={behaviours}
        enabled={enabled}
        maySpeak={maySpeak}
        columns={columns}
        tasks={tasks}
        onConfigure={configure}
        onAccept={(itemId) => void act(itemId, () => noteActions.accept(id, itemId))}
        onDismiss={(itemId) => void act(itemId, () => noteActions.dismiss(id, itemId))}
        onCovered={(itemId, covered) =>
          void act(itemId, () => noteActions.setCovered(id, itemId, covered))
        }
        busyId={busyId}
      />
    </div>
  );
}
