import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from './useDocumentTitle.js';
import { Button, Empty } from './ui/primitives.js';
import {
  Composer,
  ConversationView,
  listConversations,
  useConversation,
  type ConversationSummary,
} from './conversation/index.js';

/**
 * The assistant, with room and a memory.
 *
 * Every conversation anyone has had with this platform is in Postgres, along with the tool
 * calls and the entity cards each answer resolved — and until now nothing read any of it
 * back. `GET /assistant/conversations` shipped with the assistant and had no caller, so the
 * thread you had yesterday was gone the moment you closed the panel.
 *
 * This is where a conversation goes when it stops being one question. The command bar still
 * answers in place — that path has to stay a keystroke — and hands off to here when the
 * answer turns into a discussion, carrying the conversation with it so nothing is retyped.
 */
export function AssistantPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { turns, conversationId, busy, waited, error, ask, open, reset } = useConversation();
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useDocumentTitle('Assistant');

  const refreshHistory = useCallback(() => {
    listConversations()
      .then(setHistory)
      // The list is a convenience; failing to load it must not take the page down.
      .catch(() => setHistory([]));
  }, []);

  useEffect(refreshHistory, [refreshHistory]);

  /* Open whichever conversation the URL names, so a thread can be linked to. */
  useEffect(() => {
    if (id) void open(id);
    else reset();
  }, [id, open, reset]);

  /*
   * A question handed over from the command bar.
   *
   * Asked once and then stripped from the URL, or a refresh would ask it again — and an
   * assistant that repeats yesterday's question on every reload is worse than one that
   * forgets.
   */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const q = params.get('q');
    if (!q || asked.current === q) return;
    asked.current = q;
    void ask(q);
    setParams({}, { replace: true });
  }, [params, ask, setParams]);

  /* Follow the conversation as it grows, the way every chat does. */
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, busy]);

  /* A new thread gets its own URL once the server has named it. */
  useEffect(() => {
    if (conversationId && !id) {
      navigate(`/assistant/${conversationId}`, { replace: true });
      refreshHistory();
    }
  }, [conversationId, id, navigate, refreshHistory]);

  return (
    <div className="assistant-page">
      <aside className="assistant-history">
        <div className="row">
          <h2>Conversations</h2>
          <Button size="sm" onClick={() => navigate('/assistant')}>
            New
          </Button>
        </div>
        {history.length === 0 ? (
          <p className="muted">Nothing yet. Ask something.</p>
        ) : (
          <ul>
            {history.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === (id ?? conversationId) ? 'nav-row active' : 'nav-row'}
                  onClick={() => navigate(`/assistant/${c.id}`)}
                >
                  <span className="nav-label">{c.title ?? 'Untitled'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="assistant-main">
        {turns.length === 0 && !busy ? (
          <Empty>
            Ask about a client, a project, an invoice or what was said in a meeting. Answers
            cite the records they came from, so you can check them rather than take them on
            trust.
          </Empty>
        ) : (
          <ConversationView turns={turns} busy={busy} waited={waited} />
        )}
        <div ref={bottom} />
        {error && <p className="error">{error}</p>}
        <Composer onSend={(m) => void ask(m)} busy={busy} autoFocus />
      </div>
    </div>
  );
}
