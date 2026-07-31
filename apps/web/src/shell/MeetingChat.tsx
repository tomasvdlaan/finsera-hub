import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useConversation, type Turn } from './conversation/index.js';

interface MeetingChat {
  /** Which meeting the thread below belongs to. */
  noteId: string | null;
  turns: Turn[];
  busy: boolean;
  /** Seconds spent waiting, because the assistant does not stream. */
  waited: number;
  /**
   * Bumped when the assistant wrote into the note.
   *
   * The room watches this to reload the data around the document. A counter rather than a
   * callback, matching how the live session signals the same thing.
   */
  wroteAt: number;
  ask: (noteId: string, question: string) => Promise<void>;
  clear: () => void;
}

const Context = createContext<MeetingChat | null>(null);

/**
 * The meeting's own thread, kept above the panel that shows it.
 *
 * Two things about this are deliberate and were learned the hard way. It lives above the
 * router, because the rail unmounts when you switch from Assistant to Board and that used to
 * throw the whole conversation away. And it is scoped per meeting: carrying one note's thread
 * into the next would offer the model the wrong context and the reader the wrong history.
 *
 * What is no longer its own is the conversation itself. This used to hold turns, a
 * conversationId and its own fetch — one of three implementations of the same thing, and the
 * only one that never rendered the entity cards an answer cites. It wraps the shared engine
 * now, so the room's chat gained cards, a timeout and stored history without being touched.
 */
export function MeetingChatProvider({ children }: { children: ReactNode }) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const chat = useConversation();

  const clear = useCallback(() => {
    chat.reset();
    setNoteId(null);
  }, [chat]);

  const ask = useCallback(
    async (forNote: string, question: string) => {
      // A different meeting is a different subject. Starting over is more honest than
      // silently carrying one note's context into another's answers.
      if (noteId !== forNote) {
        chat.reset();
        setNoteId(forNote);
      }
      await chat.ask(question, { entityId: forNote });
    },
    [chat, noteId],
  );

  return (
    <Context.Provider
      value={{
        noteId,
        turns: chat.turns,
        busy: chat.busy,
        waited: chat.waited,
        wroteAt: chat.wroteAt,
        ask,
        clear,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useMeetingChat(): MeetingChat {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useMeetingChat must be used inside MeetingChatProvider');
  return ctx;
}
