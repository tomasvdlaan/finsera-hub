/**
 * The live meeting protocol, as a pure function.
 *
 * Everything the server says during a meeting arrives on one socket and lands here. It is
 * separated from the component that owns the socket for one reason: this is the only place
 * in the web app where mishandling a message loses part of a real meeting — a transcript
 * line, a proposal somebody made out loud, the note the assistant wrote — and a reducer can
 * be tested where a WebSocket callback inside a 559-line component cannot.
 *
 * Every message the gateway documents is handled below, and an unrecognised one leaves the
 * state untouched rather than throwing, because a future server should not be able to break a
 * running meeting in an older tab.
 */

export type Source = 'bot' | 'microphone' | 'tab';

export interface Line {
  id: string;
  at: number;
  /** Present when the capture provider knows who spoke — a real name, not "Speaker 1". */
  speaker?: string;
  text: string;
}

export interface Proposal {
  id: string;
  kind: 'action' | 'decision' | 'note' | 'agenda_covered';
  text: string;
  agendaItemId?: string;
}

/** What the extraction pass has gathered so far. Replaced wholesale each pass. */
/** A document the assistant went and found, bearing on something proposed out loud. */
export interface FoundContext {
  entityId: string;
  entityType: string;
  title: string;
  snippet: string;
  via: string;
}

export interface Extraction {
  summary: string;
  decisions: string[];
  openQuestions: string[];
}

export interface LiveState {
  /** Which note this session belongs to, or null when nothing is running. */
  noteId: string | null;
  running: boolean;
  source: Source | null;
  startedAt: string | null;
  lines: Line[];
  proposals: Proposal[];
  /** The note-taker's section, rewritten every ~90s rather than appended. */
  aiNotes: string | null;
  extraction: Extraction | null;
  costCents: number;
  /** What the assistant has said out loud, when it is allowed to speak. */
  spoken: string[];
  /**
   * When the bot actually got into the call, as opposed to when it was sent.
   *
   * Two different `ready` messages arrive on this socket and they mean different things: the
   * gateway's says the socket is up, the runner's carries `joinedAt` and says the capture
   * provider is in the meeting. A bot can sit in a lobby for a minute waiting to be admitted,
   * and the difference between "sent" and "in the call" is the single thing you most want to
   * know while staring at a screen wondering whether it worked.
   */
  joinedAt: string | null;
  /** Who the capture provider can currently hear. Only a bot knows this. */
  present: string[];
  /** Why the capture stopped, when it stopped on its own. */
  endedReason: string | null;
  /** A bot is on its way to the call and has not arrived. */
  connecting: boolean;
  /**
   * What it found, keyed by the proposal that prompted the search.
   *
   * Not persisted anywhere — it is context for the conversation happening now, and the note
   * keeps what the conversation concluded rather than what the assistant happened to read.
   */
  context: Record<string, FoundContext[]>;
  error: string | null;
  /**
   * Running, but this tab is not sending any audio and cannot start on its own.
   *
   * A shared tab always needs a fresh gesture; a microphone needs one when permission has
   * been refused or another tab holds the device. Either way somebody has to press something,
   * and until they do the meeting is recording silence.
   */
  needsAudio: boolean;
  /**
   * Bumped whenever something happened that makes the persisted note stale — somebody
   * joined, or the meeting ended. A counter rather than a callback so the reducer stays
   * pure; a consumer watches it and refetches.
   */
  noteStaleAt: number;
}

export const EMPTY: LiveState = {
  noteId: null,
  running: false,
  source: null,
  startedAt: null,
  lines: [],
  proposals: [],
  aiNotes: null,
  extraction: null,
  costCents: 0,
  spoken: [],
  joinedAt: null,
  present: [],
  endedReason: null,
  connecting: false,
  context: {},
  error: null,
  needsAudio: false,
  noteStaleAt: 0,
};

/** What `GET /meetings/:id/live` returns for a session that is still going. */
export interface LiveStatus {
  running: boolean;
  provider?: string;
  /** Nobody is feeding it audio: the window in which a reloaded tab can take it back over. */
  awaitingAudio?: boolean;
  source?: Source;
  startedAt?: string;
  joinedAt?: string | null;
  /** Names the capture provider can hear. Only a bot reports any. */
  speakers?: string[];
  lines?: Line[];
  proposals?: Proposal[];
  state?: Extraction;
  costCents?: number;
}

export type LiveAction =
  /** A meeting is being started from this tab. */
  | { type: 'starting'; noteId: string; source: Source }
  /** A bot has been dispatched and has not reported in. */
  | { type: 'connecting'; noteId: string }
  /** A meeting was found still running and is being picked back up. */
  | { type: 'resumed'; noteId: string; status: LiveStatus }
  /** One message off the socket, exactly as it arrived. */
  | { type: 'message'; message: Record<string, unknown> }
  | { type: 'failed'; message: string }
  /** Running, unfed, and this tab could not re-acquire the audio on its own. */
  | { type: 'needsAudio' }
  /** Audio is in hand. The only thing that clears needsAudio — see the note there. */
  | { type: 'audioOk' }
  /** The socket closed, for any reason. Does not by itself mean the meeting was saved. */
  | { type: 'closed' }
  | { type: 'reset' };

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'reset':
      return EMPTY;

    case 'starting':
      // A fresh session replaces whatever was here; carrying lines over from a previous
      // meeting would attribute one meeting's words to another.
      return { ...EMPTY, noteId: action.noteId, source: action.source };

    case 'connecting':
      // Told the bot to go, nothing back from it yet. Distinct from running, because a bot
      // that never gets admitted would otherwise look identical to one that is listening.
      return { ...EMPTY, noteId: action.noteId, source: 'bot', connecting: true };

    case 'resumed':
      return {
        ...EMPTY,
        noteId: action.noteId,
        running: true,
        source:
          action.status.provider === 'recall' ? 'bot' : (action.status.source ?? 'microphone'),
        startedAt: action.status.startedAt ?? null,
        // Restored, not rebuilt from the socket: these arrive once, as events, and a tab that
        // joins afterwards would otherwise never learn them.
        joinedAt: action.status.joinedAt ?? null,
        present: action.status.speakers ?? [],
        lines: action.status.lines ?? [],
        proposals: action.status.proposals ?? [],
        extraction: action.status.state ?? null,
        costCents: action.status.costCents ?? 0,
      };

    case 'failed':
      return { ...state, error: action.message };

    case 'needsAudio':
      return { ...state, needsAudio: true };

    case 'audioOk':
      return { ...state, needsAudio: false };

    case 'closed':
      // The socket going away stops the recording but leaves everything gathered on screen:
      // the meeting just ended and its contents are the last thing you want cleared.
      return { ...state, running: false, connecting: false, present: [] };

    case 'message':
      return applyMessage(state, action.message);
  }
}

function applyMessage(state: LiveState, message: Record<string, unknown>): LiveState {
  switch (message.type) {
    /*
     * Deliberately does not clear needsAudio.
     *
     * `ready` means the server has accepted the socket, which is not the same as this tab
     * having a microphone. It cleared the flag once, and the result was a room reporting a
     * live recording with a running clock while capturing nothing at all — the socket had
     * reconnected and taken the session over, and getUserMedia had been refused. Only
     * actually holding a stream clears it.
     */
    case 'ready':
      return {
        ...state,
        running: true,
        connecting: false,
        error: null,
        // Only the runner's ready carries this, and only for a bot: it is the moment the
        // provider got into the call rather than the moment the socket opened.
        joinedAt: (message.joinedAt as string) ?? state.joinedAt,
        startedAt: (message.startedAt as string) ?? state.startedAt,
      };

    case 'line': {
      const line = message.line as Line;
      // A reconnect can replay. A duplicated line in a client meeting record is worse than
      // a missing one, so identity wins over arrival order.
      if (state.lines.some((l) => l.id === line.id)) return state;
      return { ...state, lines: [...state.lines, line] };
    }

    case 'proposals': {
      const incoming = (message.proposals as Proposal[]) ?? [];
      const known = new Set(state.proposals.map((p) => p.id));
      const fresh = incoming.filter((p) => !known.has(p.id));
      return fresh.length === 0 ? state : { ...state, proposals: [...state.proposals, ...fresh] };
    }

    // Replaced, not appended: the note-taker owns its section and rewrites it. Appending
    // would show every draft of the same paragraph.
    case 'notes':
      return { ...state, aiNotes: message.markdown as string };

    case 'state':
      return { ...state, extraction: message.state as Extraction };

    case 'cost':
      return { ...state, costCents: message.costCents as number };

    case 'spoke':
      return { ...state, spoken: [...state.spoken, String(message.text)] };

    // Sent by context_finder, which searches unasked. Keyed by proposal so it renders next to
    // the thing it is about rather than in a pile of its own.
    case 'context': {
      const forId = String(message.forProposalId);
      const hits = (message.hits as FoundContext[]) ?? [];
      if (hits.length === 0) return state;
      return { ...state, context: { ...state.context, [forId]: hits } };
    }

    // Somebody joined the call, so the persisted attendee list and any consent warning are
    // now behind. Nothing about the session itself changed.
    case 'attendees':
      return { ...state, noteStaleAt: state.noteStaleAt + 1 };

    case 'stopped':
    case 'ended':
      return {
        ...state,
        running: false,
        needsAudio: false,
        present: [],
        // 'ended' means the capture dropped rather than somebody pressing stop, and the reason
        // is the only explanation anyone gets for a meeting that stopped by itself.
        endedReason: (message.reason as string) ?? state.endedReason,
        costCents: (message.costCents as number) ?? state.costCents,
        noteStaleAt: state.noteStaleAt + 1,
      };

    case 'error':
      return { ...state, error: String(message.message) };

    /*
     * Who is in the call.
     *
     * This used to be discarded — "roster changes are visible in the transcript itself" — which
     * is true of somebody who has spoken and useless for somebody who has not. A person sitting
     * silently in a meeting appears nowhere in a transcript, and "is the bot hearing everyone"
     * is a question you ask before anybody has said anything.
     */
    case 'speaker': {
      const who = String((message.speaker as { name?: string } | string) instanceof Object
        ? ((message.speaker as { name?: string }).name ?? '')
        : message.speaker);
      if (!who) return state;
      const others = state.present.filter((p) => p !== who);
      return {
        ...state,
        present: message.event === 'left' ? others : [...others, who],
      };
    }

    default:
      return state;
  }
}

/** Seconds a session has been running, from a server timestamp. */
export const elapsedSeconds = (startedAt: string | null, now = Date.now()): number =>
  startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : 0;
