import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { chatWidgets } from '../modules/index.js';
import type { ChatWidgetProps } from '../modules/types.js';
import { Link } from 'react-router-dom';

interface ToolCall {
  toolName: string;
  module: string;
  riskClass: string;
  executed: boolean;
  reason?: string;
}

interface Reference {
  id: string;
  entityType: string;
  displayName: string;
  urlPath: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  references?: Reference[];
  pending?: boolean;
}

/**
 * Render a reference using whichever module registered a card for its entity type.
 *
 * An unregistered type falls back to a link rather than breaking: a new entity type is
 * never wrong in chat, only plainer than it could be.
 */
function ReferenceCard(props: ChatWidgetProps) {
  const Widget = chatWidgets[props.entityType];
  if (Widget) return <Widget {...props} />;
  return (
    <div className="chat-card">
      <div className="chat-card-head">
        <span className="badge">{props.entityType}</span>
        <Link to={props.urlPath}>{props.displayName}</Link>
      </div>
    </div>
  );
}

const CITATION = /\[\[entity:([0-9a-f-]{36})\]\]/gi;

/**
 * Split an answer on [[entity:id]] citations, rendering each as its card in place.
 *
 * Only cited records become cards, and the server has already dropped any citation it
 * could not ground in a tool result or that this user may not see. A citation the server
 * did not approve renders as nothing at all rather than leaving [[entity:…]] on screen.
 */
function AnswerBody({ text, references }: { text: string; references: Reference[] }) {
  const byId = new Map(references.map((r) => [r.id.toLowerCase(), r]));
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(text.slice(cursor, at));
    const ref = byId.get(match[1]!.toLowerCase());
    if (ref) parts.push(<ReferenceCard key={`${ref.id}-${at}`} {...ref} />);
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  // Trailing whitespace left by a stripped citation reads as a formatting bug.
  return <div className="turn-content">{parts}</div>;
}

/**
 * The assistant sidebar (AI plan §2; decision O5 — sidebar first, command palette later).
 *
 * It is context-aware: the entity id in the current URL is passed along, so "this client"
 * resolves without the user naming it.
 */
export function Assistant({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  /** The last UUID in the path is the record being viewed, if any. */
  const contextEntityId = location.pathname.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )?.[0];

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    setInput('');
    setError(null);
    setTurns((t) => [...t, { role: 'user', content: message }, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);

    try {
      const res = await api.post<{
        conversationId: string;
        answer: string;
        toolCalls: ToolCall[];
        references: Reference[];
      }>('/assistant/ask', { message, conversationId, context: { entityId: contextEntityId } });

      setConversationId(res.conversationId);
      setTurns((t) => [
        ...t.slice(0, -1),
        {
          role: 'assistant',
          content: res.answer,
          toolCalls: res.toolCalls,
          references: res.references,
        },
      ]);
    } catch (err) {
      setTurns((t) => t.slice(0, -1));
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
  };

  return (
    <aside className="assistant">
      <div className="assistant-head">
        <strong>Assistant</strong>
        <div>
          <button className="link-button" onClick={reset}>
            new
          </button>
          <button className="link-button" onClick={onClose}>
            close
          </button>
        </div>
      </div>

      <div className="assistant-body">
        {turns.length === 0 && (
          <p className="muted">
            Ask about clients, projects or hours — for example “how many hours have gone into
            Power BI?” or “which clients are active?”. Answers come from the platform&rsquo;s own
            data, under your permissions.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`turn turn-${turn.role}`}>
            {turn.pending ? (
              <span className="muted">thinking…</span>
            ) : (
              <>
                <AnswerBody text={turn.content} references={turn.references ?? []} />
                {/* Transparency: what the assistant actually did to answer. */}
                {turn.toolCalls && turn.toolCalls.length > 0 && (
                  <div className="turn-tools">
                    {turn.toolCalls.map((c, j) => (
                      <span key={j} className="badge" title={`${c.module} · ${c.riskClass}`}>
                        {c.toolName}
                        {!c.executed && ' (awaiting confirmation)'}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {error && <p className="error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => void send(e)} className="assistant-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={contextEntityId ? 'Ask about this record…' : 'Ask something…'}
          aria-label="Ask the assistant"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </aside>
  );
}
