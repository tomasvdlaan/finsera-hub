import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { chatWidgets } from '../../modules/index.js';
import type { ChatWidgetProps } from '../../modules/types.js';
import type { Reference, Turn } from './useConversation.js';

/**
 * Render a reference using whichever module registered a card for its entity type.
 *
 * An unregistered type falls back to a link rather than breaking: a new entity type is never
 * wrong in chat, only plainer than it could be.
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
 * Split an answer on `[[entity:id]]` citations, rendering each as its card in place.
 *
 * Only cited records become cards, and the server has already dropped any citation it could
 * not ground in a tool result or that this user may not see. A citation the server did not
 * approve renders as nothing at all rather than leaving `[[entity:…]]` on screen.
 */
function AnswerBody({ text, references }: { text: string; references: Reference[] }) {
  const byId = new Map(references.map((r) => [r.id.toLowerCase(), r]));
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(text.slice(cursor, at));
    const ref = byId.get(match[1]!.toLowerCase());
    if (ref) parts.push(<ReferenceCard key={`${ref.id}-${at}`} {...ref} />);
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <div className="turn-content">{parts}</div>;
}

/**
 * A conversation, drawn the same way everywhere it appears.
 *
 * This used to exist once, in the sidebar panel — so the meeting room's chat and the command
 * bar both showed answers without their entity cards, and a question about an invoice came
 * back as a sentence in one place and a card in another. There is one of these now, and the
 * three surfaces differ only in where they put it.
 */
export function ConversationView({
  turns,
  busy,
  waited,
  compact,
}: {
  turns: Turn[];
  busy?: boolean;
  /** Seconds spent waiting, because the assistant does not stream. */
  waited?: number;
  /** Tighter spacing for the meeting rail and the command bar. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'chat chat-compact' : 'chat'}>
      {turns.map((turn, i) => (
        <div key={i} className={`turn turn-${turn.role}`}>
          {turn.role === 'assistant' ? (
            <AnswerBody text={turn.content} references={turn.references ?? []} />
          ) : (
            <div className="turn-content">{turn.content}</div>
          )}

          {/* What it looked at, so an answer can be checked rather than trusted. */}
          {turn.toolCalls && turn.toolCalls.length > 0 && (
            <div className="turn-tools">
              {turn.toolCalls.map((c, j) => (
                <span
                  key={j}
                  className="tag"
                  title={c.executed ? `${c.module} · ${c.riskClass}` : (c.reason ?? 'not run')}
                >
                  {c.executed ? c.toolName : `${c.toolName} (skipped)`}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {busy && (
        <div className="turn turn-assistant">
          <div className="turn-content muted">
            Thinking{waited && waited > 2 ? ` — ${waited}s` : '…'}
          </div>
        </div>
      )}
    </div>
  );
}
