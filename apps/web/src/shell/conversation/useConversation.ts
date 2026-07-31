import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

/** A question that runs a model can legitimately take a while; this is a backstop. */
const ASK_TIMEOUT_MS = 120_000;

export interface ToolCall {
  toolName: string;
  module: string;
  riskClass: string;
  executed: boolean;
  reason?: string;
}

export interface Reference {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  references?: Reference[];
  pending?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

/**
 * One conversation with the assistant, wherever it is being shown.
 *
 * There were three of these. A sidebar panel that threaded and rendered entity cards but
 * never loaded a past conversation; a meeting-room chat that threaded and had no cards; and
 * the command bar, which asked one question and forgot it. Three clients of one API, each
 * missing something the others had — and each having to be fixed separately.
 *
 * Underneath, the server was already a chat product: conversations and their messages are in
 * Postgres, and the messages table stores the tool calls and the resolved references
 * alongside the text so that reopening a thread shows its cards without replaying anything.
 * Nothing had ever read any of it back.
 */
export function useConversation() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped when the assistant wrote into a note.
   *
   * A counter rather than a callback: the room watches it to know its data is behind, and a
   * callback would have to be threaded through every surface that renders a conversation.
   */
  const [wroteAt, setWroteAt] = useState(0);
  const busyRef = useRef(false);

  const reset = useCallback(() => {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
  }, []);

  /** Reopen a stored conversation, cards and all. */
  const open = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await api.get<{
        id: string;
        messages: Array<{
          role: 'user' | 'assistant';
          content: string;
          toolCalls?: ToolCall[];
          references?: Reference[];
        }>;
      }>(`/assistant/conversations/${id}`);
      setConversationId(res.id);
      setTurns(
        res.messages.map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          references: m.references,
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const ask = useCallback(
    async (message: string, context?: { entityId?: string }) => {
      const text = message.trim();
      // A ref as well as state: two keystrokes can submit before React has re-rendered.
      if (!text || busyRef.current) return;
      busyRef.current = true;

      setTurns((current) => [...current, { role: 'user', content: text }]);
      setBusy(true);
      setWaited(0);
      setError(null);

      const ticker = setInterval(() => setWaited((n) => n + 1), 1000);
      /*
       * `fetch` has no timeout, and this refuses a new question while one is in flight — so a
       * request that never settled used to leave the panel dead until the page was reloaded.
       */
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), ASK_TIMEOUT_MS);

      try {
        const res = await api.post<{
          conversationId: string;
          answer: string;
          toolCalls?: ToolCall[];
          references?: Reference[];
        }>(
          '/assistant/ask',
          { message: text, conversationId, context: context ?? {} },
          abort.signal,
        );

        setConversationId(res.conversationId);
        if ((res.toolCalls ?? []).some((t) => t.toolName === 'meetings_write_note')) {
          setWroteAt((n) => n + 1);
        }
        setTurns((current) => [
          ...current,
          {
            role: 'assistant',
            content: res.answer,
            toolCalls: res.toolCalls,
            references: res.references,
          },
        ]);
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        const text = aborted
          ? 'That took too long and was given up on. The question was not lost — ask it again.'
          : (e as Error).message;
        setTurns((current) => [...current, { role: 'assistant', content: text }]);
        setError(text);
      } finally {
        clearTimeout(deadline);
        clearInterval(ticker);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [conversationId],
  );

  return { turns, conversationId, busy, waited, error, wroteAt, ask, open, reset, setTurns };
}

/** Every conversation this user has had. The endpoint has existed since the assistant did. */
export async function listConversations(): Promise<ConversationSummary[]> {
  return api.get<ConversationSummary[]>('/assistant/conversations');
}
