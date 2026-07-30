import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** What the assistant looked at to answer, shown so the answer can be checked. */
  tools?: string[];
}

interface MeetingChat {
  /** Which meeting the thread below belongs to. */
  noteId: string | null;
  turns: ChatTurn[];
  asking: boolean;
  /** Seconds spent waiting, because the assistant does not stream. */
  waited: number;
  /**
   * Bumped when the assistant wrote into the note.
   *
   * The editor is open while this happens and autosaves what it holds, so a page that does not
   * reload would overwrite the assistant's paragraph with its own stale copy a second later.
   * A counter rather than a callback, matching how the live session signals the same thing.
   */
  wroteAt: number;
  ask: (noteId: string, question: string) => Promise<void>;
  clear: () => void;
}

/** How long a question may run before the panel gives up on it. */
const ASK_TIMEOUT_MS = 120_000;

const Context = createContext<MeetingChat | null>(null);

/**
 * Questions asked about a meeting, kept above the panel that asks them.
 *
 * The room's ask box held its own state, so switching the rail from Assistant to Board threw
 * the answer away — the panel unmounts, and with it went the question, the reply and the list
 * of what had been looked at. Leaving the room lost it again.
 *
 * It also sent no conversationId, so every question opened a fresh conversation server-side.
 * "And what did they say about the second one?" had nothing to refer back to, which makes a
 * chat box a search box with extra steps.
 *
 * Held per meeting rather than globally: the thread is about this note, and carrying it into
 * the next meeting would offer the model the wrong context and the operator the wrong history.
 */
export function MeetingChatProvider({ children }: { children: ReactNode }) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [waited, setWaited] = useState(0);
  const [wroteAt, setWroteAt] = useState(0);

  const clear = useCallback(() => {
    setTurns([]);
    setConversationId(undefined);
    setNoteId(null);
  }, []);

  const ask = useCallback(
    async (forNote: string, question: string) => {
      const text = question.trim();
      if (!text || asking) return;

      // A different meeting is a different subject. Starting a thread over is more honest than
      // silently carrying one note's context into another's answers.
      const sameThread = noteId === forNote;
      const history = sameThread ? turns : [];
      setNoteId(forNote);
      setTurns([...history, { role: 'user', text }]);
      setAsking(true);
      setWaited(0);

      const ticker = setInterval(() => setWaited((n) => n + 1), 1000);
      /*
       * A question that never comes back must not take the panel with it.
       *
       * `ask` refuses a new question while one is in flight, and `fetch` has no timeout — so a
       * request that never settled left `asking` true for good and the panel dead until the
       * page was reloaded. Reported as the whole program freezing, which from the outside is
       * exactly what it looks like.
       *
       * Generous, because a question that makes the assistant search documents and then write
       * into the note legitimately takes a while. It is a backstop, not a deadline.
       */
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);
      try {
        const res = await api.post<{
          answer: string;
          conversationId?: string;
          toolCalls?: Array<{ toolName: string }>;
        }>(
          '/assistant/ask',
          {
            message: text,
            // Continuing the thread is what makes a follow-up question mean anything.
            conversationId: sameThread ? conversationId : undefined,
            context: { entityId: forNote },
          },
          abort.signal,
        );
        setConversationId(res.conversationId);
        // The note on screen is now behind whatever the assistant just wrote into it.
        if ((res.toolCalls ?? []).some((t) => t.toolName === 'meetings_write_note')) {
          setWroteAt((n) => n + 1);
        }
        setTurns((current) => [
          ...current,
          {
            role: 'assistant',
            text: res.answer,
            tools: (res.toolCalls ?? []).map((t) => t.toolName),
          },
        ]);
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        setTurns((current) => [
          ...current,
          {
            role: 'assistant',
            text: aborted
              ? 'That took too long and was given up on. The question was not lost — ask it again.'
              : (e as Error).message,
          },
        ]);
      } finally {
        clearTimeout(deadline);
        clearInterval(ticker);
        setAsking(false);
      }
    },
    [asking, conversationId, noteId, turns],
  );

  return (
    <Context.Provider value={{ noteId, turns, asking, waited, wroteAt, ask, clear }}>
      {children}
    </Context.Provider>
  );
}

export function useMeetingChat(): MeetingChat {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useMeetingChat must be used inside MeetingChatProvider');
  return ctx;
}
