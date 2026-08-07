import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '../ui/MarkdownEditor.js';
import { chatWidgets } from '../../modules/index.js';
import type { ChatWidgetProps } from '../../modules/types.js';
import { latestThought } from './thinking.js';
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
 * Split an answer on `[[entity:id]]` citations, rendering each as its card in place and the
 * text between them as Markdown.
 *
 * Only cited records become cards, and the server has already dropped any citation it could
 * not ground in a tool result or that this user may not see. A citation the server did not
 * approve renders as nothing at all rather than leaving `[[entity:…]]` on screen.
 *
 * The model has always written Markdown — headings, lists, bold, tables — and this rendered
 * it as literal asterisks and hashes, which is the single thing that made the assistant look
 * unfinished next to every other chat product. It parses with the same `@platform/note-doc`
 * schema the notes and task descriptions use, so an answer, a meeting note and a card
 * description all say a bullet the same way.
 *
 * Each stretch between citations is parsed separately, which means a citation dropped inside
 * a paragraph splits it in two. That is the honest trade for cards being block elements, and
 * it is rare by construction: the system prompt asks for at most one or two citations, placed
 * where a reader would follow them.
 */
function AnswerBody({ text, references }: { text: string; references: Reference[] }) {
  const byId = new Map(references.map((r) => [r.id.toLowerCase(), r]));
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(<Markdown key={`t-${cursor}`} value={text.slice(cursor, at)} />);
    const ref = byId.get(match[1]!.toLowerCase());
    if (ref) parts.push(<ReferenceCard key={`${ref.id}-${at}`} {...ref} />);
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push(<Markdown key={`t-${cursor}`} value={text.slice(cursor)} />);

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
  onStop,
  onRegenerate,
  onStar,
  onSplit,
}: {
  turns: Turn[];
  busy?: boolean;
  /** Seconds spent waiting — now only until the first token arrives. */
  waited?: number;
  /** Tighter spacing for the meeting rail and the command bar. */
  compact?: boolean;
  /** Give up on the answer in flight, keeping whatever arrived. */
  onStop?: () => void;
  onRegenerate?: () => void;
  /** Keep this answer, away from the thread it is buried in. */
  onStar?: (turn: Turn) => void;
  /** Cut the thread here, where the subject changed. */
  onSplit?: (turn: Turn) => void;
}) {
  const last = turns.length - 1;
  return (
    <div className={compact ? 'chat chat-compact' : 'chat'}>
      {turns.map((turn, i) => (
        <div key={i} className={`turn turn-${turn.role}`}>
          {turn.role === 'assistant' ? (
            <>
              {/*
                What it is doing, while it is doing it.
                
                Shown above the text rather than below, because for most of a real answer
                there is no text yet — the wait is tool calls, and this is the only thing on
                screen that is true during it.
              */}
              {turn.pending && (turn.running?.length ?? 0) > 0 && (
                <div className="turn-running" aria-live="polite">
                  {turn.running!.map((name, j) => (
                    <span key={j} className="tag running-tag">
                      {humanise(name)}
                    </span>
                  ))}
                </div>
              )}

              {/*
                What it is thinking about, in one line.

                The tool chips above only appear once a tool has been called, and on a measured
                answer that was 3.1 seconds in — with another 5.7 seconds of silence after it
                and the entire reply arriving in the last 57 milliseconds. This is what fills
                those stretches: the model's own heading for whatever it is doing, replaced as
                it moves on.

                One line on purpose. The full working-out is underneath for anybody who wants
                it, and folded away for everybody who does not.
              */}
              {latestThought(turn.thinking) && (
                <div className="turn-thinking">
                  <p className="thinking-line" aria-live="polite">
                    {latestThought(turn.thinking)}
                  </p>
                  <details>
                    <summary className="muted">Show the working-out</summary>
                    <Markdown value={turn.thinking!} />
                  </details>
                </div>
              )}
              <AnswerBody text={turn.content} references={turn.references ?? []} />
              {/* A caret while the words are still arriving, so a pause reads as thinking
                  rather than as finished. */}
              {turn.pending && <span className="stream-caret" aria-hidden="true" />}
            </>
          ) : (
            <div className="turn-content">{turn.content}</div>
          )}

          {/*
            Copy and retry, on the finished answer only.
            
            On the last one only, too: a row of buttons under every turn is a page of buttons,
            and regenerating anything but the most recent answer would strand everything after
            it against a question that no longer produced it.
          */}
          {turn.role === 'assistant' && !turn.pending && turn.content && (
            <div className="turn-actions">
              <button type="button" className="link-button" onClick={() => void copy(turn.content)}>
                copy
              </button>
              {i === last && onRegenerate && !busy && (
                <button type="button" className="link-button" onClick={onRegenerate}>
                  try again
                </button>
              )}
              {onStar && turn.messageId && (
                <button type="button" className="link-button" onClick={() => onStar(turn)}>
                  {turn.starred ? 'unstar' : 'star'}
                </button>
              )}
              {/* Not on the first answer: a split there would move the whole thread. */}
              {onSplit && turn.messageId && i > 1 && (
                <button type="button" className="link-button" onClick={() => onSplit(turn)}>
                  split here
                </button>
              )}
            </div>
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

      {/* Only until the streamed turn exists — after that the turn speaks for itself, and
          two "thinking" indicators is one too many. */}
      {busy && !turns.some((t) => t.pending) && (
        <div className="turn turn-assistant">
          <div className="turn-content muted">
            Thinking{waited && waited > 2 ? ` — ${waited}s` : '…'}
          </div>
        </div>
      )}

      {/* Only while something is actually in flight, and below it, where the eye already is. */}
      {busy && onStop && (
        <div className="chat-stop">
          <button type="button" className="chip" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A tool name a person can read.
 *
 * Derived rather than mapped. Forty tools with hand-written labels is forty things to forget
 * to update, and the names already follow `module_verb_noun` — so dropping the module and
 * unpicking the underscores gets most of the way there with nothing to maintain.
 */
function humanise(toolName: string): string {
  const words = toolName.split('_');
  const rest = words.length > 1 ? words.slice(1) : words;
  return rest.join(' ');
}

/**
 * Copy an answer.
 *
 * The Markdown, not the rendered text — it is what the model wrote and what pastes usefully
 * into a note, a card description or an email. Silent on failure: the clipboard is denied in
 * plenty of legitimate situations and an error toast about it helps nobody.
 */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* nothing to do about it */
  }
}
